import { normalizeHeaderLabel, studentTemplateColumns } from "./student-excel";
import { questionTemplateSheets } from "./question-excel";

/**
 * Target rows per request. Small enough that the progress bar keeps moving on a
 * long sheet, large enough that a 10 row file still costs one round trip. Rows
 * that share an email or a reference number always stay together even when that
 * pushes a chunk past this number, because splitting them would change how the
 * server resolves them.
 */
export const IMPORT_CHUNK_SIZE = 25;

/** Sheet name the student import template uses. */
export const IMPORT_SHEET_NAME = "الطلاب";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Which template the uploaded file follows. The student file is a single sheet
 * read from the top, while the question file carries one sheet per question type
 * that the server resolves by name, so the two need opposite handling.
 */
export type ImportChunkKind = "students" | "questions";

export type ImportChunkError = { row: number; message: string };

export type ImportChunkPlan = {
  /** Data rows found in the uploaded sheet. */
  total: number;
  chunks: File[];
  /** Sheet line the original header was on, so callers can explain it. */
  headerIndex: number;
  /** Sheet line of each chunk's first data row. Chunks vary in size, so this is
   *  computed while planning rather than derived from the chunk index. */
  firstLines: number[];
  /** Data rows carried by each chunk. */
  rowCounts: number[];
  /** Sheet each chunk was cut from, so a multi-sheet file can label its rows. */
  sheetNames: string[];
};

const columnKeys = ["email", "universityId"] as const;

type ColumnIndexes = Partial<Record<(typeof columnKeys)[number], number>>;

function resolveColumnIndexes(header: unknown[]): ColumnIndexes {
  const indexes: ColumnIndexes = {};

  header.forEach((cell, index) => {
    const label = normalizeHeaderLabel(String(cell ?? ""));
    for (const key of columnKeys) {
      const column = studentTemplateColumns.find((candidate) => candidate.key === key);
      if (column && normalizeHeaderLabel(column.label) === label) indexes[key] = index;
    }
  });

  return indexes;
}

/**
 * The server resolves an already-created student by email, or by reference number
 * when that number is unique, and it deliberately ignores the students the same
 * upload just created. That tracking lives in one request only, so rows sharing
 * an identifier have to reach the server together or the second row would match
 * the student the first row created and overwrite it instead of adding anyone.
 */
function identityKeys(row: unknown[], columns: ColumnIndexes): string[] {
  const keys: string[] = [];

  const email =
    columns.email === undefined ? "" : String(row[columns.email] ?? "").trim().toLowerCase();
  if (email) keys.push(`email:${email}`);

  const reference =
    columns.universityId === undefined ? "" : String(row[columns.universityId] ?? "").trim();
  if (reference) keys.push(`ref:${reference}`);

  return keys;
}

/**
 * Groups data rows into chunks while keeping the sheet's own order.
 *
 * Every chunk is a contiguous slice of the sheet, because the order rows are
 * imported in is what the admin sees in the uploaded file. A row can only ever be
 * matched against another row sharing its email or its reference number, and the
 * server deliberately ignores the students the same upload just created, so every
 * such group has to arrive inside one request or the second row would overwrite
 * the student the first row created. A group is therefore never split: when a
 * chunk would cut through one, the chunk grows to hold the whole group, which is
 * why a chunk can end up larger than `chunkSize`.
 */
export function planContiguousChunks(
  rows: unknown[][],
  columns: ColumnIndexes,
  chunkSize: number = IMPORT_CHUNK_SIZE,
): unknown[][][] {
  const shared = new Map<string, number[]>();
  rows.forEach((row, index) => {
    for (const key of identityKeys(row, columns)) {
      const members = shared.get(key);
      if (members) members.push(index);
      else shared.set(key, [index]);
    }
  });

  // Row index of the last member of the group it belongs to, for rows that share
  // an identifier with at least one other row.
  const lastOfGroup = new Map<number, number>();
  for (const members of shared.values()) {
    if (members.length < 2) continue;
    const last = members[members.length - 1];
    for (const index of members) lastOfGroup.set(index, last);
  }

  const chunks: unknown[][][] = [];
  const total = rows.length;
  let start = 0;

  while (start < total) {
    let end = Math.min(total, start + chunkSize);

    // Grow until no group is cut in half. A wider chunk can pull in more groups,
    // so this keeps going until the boundary is stable.
    for (;;) {
      let reach = end;
      for (let index = start; index < end; index += 1) {
        const last = lastOfGroup.get(index);
        if (last !== undefined && last >= end) {
          reach = Math.max(reach, last + 1);
        }
      }
      if (reach === end) break;
      end = Math.min(total, reach);
      if (end >= total) break; // no need to expand beyond the last row
    }

    chunks.push(rows.slice(start, end));
    start = end;
  }

  return chunks;
}

/** A chunk waiting to be written: the header it repeats plus its own rows. */
type PreparedChunk = { sheetName: string; header: unknown[]; firstLine: number; part: unknown[][] };

function hasData(row: unknown[]) {
  return row.some((cell) => String(cell ?? "").trim() !== "");
}

function sheetRows(XLSX: typeof import("xlsx"), sheet: import("xlsx").WorkSheet) {
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: "",
  }) as unknown[][];
}

/** Writes every prepared chunk into its own single-sheet workbook. */
function materializeChunks(
  XLSX: typeof import("xlsx"),
  file: File,
  prepared: PreparedChunk[],
  headerIndex: number,
): ImportChunkPlan {
  const chunks: File[] = [];
  const firstLines: number[] = [];
  const rowCounts: number[] = [];
  const sheetNames: string[] = [];

  for (const item of prepared) {
    const chunkBook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      chunkBook,
      XLSX.utils.aoa_to_sheet([item.header, ...item.part]),
      item.sheetName,
    );

    const buffer = XLSX.write(chunkBook, { type: "array", bookType: "xlsx", compression: true });
    chunks.push(new File([buffer], file.name, { type: XLSX_MIME }));

    firstLines.push(item.firstLine);
    rowCounts.push(item.part.length);
    sheetNames.push(item.sheetName);
  }

  return {
    total: rowCounts.reduce((sum, count) => sum + count, 0),
    chunks,
    headerIndex,
    firstLines,
    rowCounts,
    sheetNames,
  };
}

/**
 * The student template is one flat sheet read from the top, so the first sheet in
 * the file is the one to import.
 */
function planStudentChunks(
  XLSX: typeof import("xlsx"),
  workbook: import("xlsx").WorkBook,
  file: File,
  chunkSize: number,
): ImportChunkPlan {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("ملف الإكسل لا يحتوي على أي ورقة بيانات.");

  const rows = sheetRows(XLSX, sheet);
  const headerIndex = rows.findIndex(hasData);
  if (headerIndex === -1) throw new Error("ملف الإكسل فارغ.");

  const header = rows[headerIndex] ?? [];
  const dataRows = rows.slice(headerIndex + 1).filter(hasData);

  if (dataRows.length === 0) {
    return {
      total: 0,
      chunks: [],
      headerIndex,
      firstLines: [],
      rowCounts: [],
      sheetNames: [],
    };
  }

  const grouped = planContiguousChunks(dataRows, resolveColumnIndexes(header), chunkSize);

  const prepared: PreparedChunk[] = [];
  let consumed = 0;
  for (const part of grouped) {
    prepared.push({
      sheetName: IMPORT_SHEET_NAME,
      header,
      firstLine: headerIndex + consumed + 2,
      part,
    });
    consumed += part.length;
  }

  return materializeChunks(XLSX, file, prepared, headerIndex);
}

/**
 * The question template gives every question type its own sheet, and the server
 * parser looks each one up by its exact name. A chunk therefore has to keep the
 * name of the sheet it was cut from, and a fixed split is enough here: question
 * rows never have to be matched against each other the way student rows do.
 */
function planQuestionChunks(
  XLSX: typeof import("xlsx"),
  workbook: import("xlsx").WorkBook,
  file: File,
  chunkSize: number,
): ImportChunkPlan {
  const prepared: PreparedChunk[] = [];
  let headerIndex = 0;

  for (const sheetDef of questionTemplateSheets) {
    const sheet = workbook.Sheets[sheetDef.sheetName];
    if (!sheet) continue;

    const rows = sheetRows(XLSX, sheet);
    const sheetHeaderIndex = rows.findIndex(hasData);
    if (sheetHeaderIndex === -1) continue;

    const header = rows[sheetHeaderIndex] ?? [];
    const dataRows = rows.slice(sheetHeaderIndex + 1).filter(hasData);
    if (dataRows.length === 0) continue;

    if (prepared.length === 0) headerIndex = sheetHeaderIndex;

    let consumed = 0;
    for (let start = 0; start < dataRows.length; start += chunkSize) {
      const part = dataRows.slice(start, start + chunkSize);
      prepared.push({
        // The parser only ever finds a sheet by this exact name.
        sheetName: sheetDef.sheetName,
        header,
        firstLine: sheetHeaderIndex + consumed + 2,
        part,
      });
      consumed += part.length;
    }
  }

  if (prepared.length === 0) {
    const expected = questionTemplateSheets.map((sheetDef) => `«${sheetDef.sheetName}»`).join("، ");
    throw new Error(
      `لم يُعثر على أي ورقة أسئلة معبّأة. الأوراق الموجودة في الملف: ${
        workbook.SheetNames.map((name) => `«${name}»`).join("، ") || "لا شيء"
      }. ضع الأسئلة في ورقة باسمها الصحيح (${expected}) كما في القالب.`,
    );
  }

  return materializeChunks(XLSX, file, prepared, headerIndex);
}

/**
 * Splits a workbook into small sheets the server action can import one at a time,
 * which is what makes a real progress bar possible. Every chunk carries the
 * original header row and the name of the sheet it came from, so the server keeps
 * resolving fields by column name and the accepted rows stay identical to
 * uploading the whole file in one request.
 */
export async function splitWorkbookForImport(
  file: File,
  kind: ImportChunkKind = "students",
  chunkSize: number = IMPORT_CHUNK_SIZE,
): Promise<ImportChunkPlan> {
  // Loaded only once a file is actually picked: xlsx is far larger than this
  // screen and no admin visits the page expecting to download it.
  const XLSX = await import("xlsx");

  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });

  return kind === "questions"
    ? planQuestionChunks(XLSX, workbook, file, chunkSize)
    : planStudentChunks(XLSX, workbook, file, chunkSize);
}

/**
 * The server reports a row's 1-based line inside the sheet it received, where the
 * header sits on line 1. Moving that onto the original sheet is a fixed shift
 * because a chunk's first data row is line 2 and sits on `firstLine` upstream. A
 * multi-sheet file repeats line numbers per sheet, so the sheet name travels with
 * the error to keep the report unambiguous.
 */
export function shiftChunkErrors(
  errors: readonly ImportChunkError[],
  firstLine: number,
  sheetName?: string,
): ImportChunkError[] {
  const offset = firstLine - 2;
  return errors.map((error) => ({
    row: error.row + offset,
    message: sheetName ? `ورقة «${sheetName}»: ${error.message}` : error.message,
  }));
}

/** Every data row of a failed chunk, reported so nothing looks silently skipped. */
export function chunkRangeErrors(
  firstLine: number,
  rowCount: number,
  message: string,
): ImportChunkError[] {
  const errors: ImportChunkError[] = [];
  for (let offset = 0; offset < rowCount; offset += 1) {
    errors.push({ row: firstLine + offset, message });
  }
  return errors;
}