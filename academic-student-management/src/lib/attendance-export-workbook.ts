import * as XLSX from "xlsx";

import {
  missingLabel,
  statusLabels,
  type AttendanceMatrix,
  type SessionExport,
} from "@/lib/attendance-export";
import {
  exportDate,
  exportDateTime,
  exportNumber,
  exportPercentNumber,
} from "@/lib/export-format";
import { freezeTopRows } from "@/lib/xlsx-freeze";

export const sessionHeaders = [
  "المسلسل",
  "الاسم",
  "الرقم الجامعي",
  "الفرقة",
  "القسم",
  "التخصص",
  "الحالة",
  "السبب / ملاحظة",
  "وقت التسجيل",
];

const identityHeaders = ["المسلسل", "الاسم", "الرقم الجامعي", "الفرقة", "القسم", "التخصص"];

export const matrixSummaryHeaders = ["محاضر", "غائب", "بعذر", "نسبة الحضور %"];

export const matrixColumnLabels = {
  status: "الحالة",
  reason: "الاعذار",
} as const;

type Cell = string | number | null;

// Rows used for merges and freezing.
const INFO_END_ROW = 6; // 0-based: rows 0-6 are info + blank
const DATES_ROW = 7;
const STATE_TITLES_ROW = 8;
const REASON_TITLES_ROW = 9;
const TOTALS_ROW = 10;

function buildSheet(rows: Cell[][], widths: number[]) {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"] = widths.map((wch) => ({ wch }));
  return sheet;
}

function summaryLine(parts: { present: number; absent: number; excused: number; missing: number }) {
  return (
    `حاضر ${exportNumber(parts.present)} · غائب ${exportNumber(parts.absent)}` +
    ` · بعذر ${exportNumber(parts.excused)}` +
    ` · ${missingLabel} ${exportNumber(parts.missing)}`
  );
}

/**
 * One lecture as a flat table.
 *
 * The header block carries the lecture date and time, and each row carries the
 * moment its record was written. A disputed sheet is usually a question about
 * *when* something was marked rather than what it says.
 */
export function buildSessionAttendanceWorkbook(exported: SessionExport) {
  const workbook = XLSX.utils.book_new();

  const info: Cell[][] = [
    ["المادة", `${exported.subjectName} (${exported.subjectCode})`],
    ["المحاضرة", exported.title ?? "بدون عنوان"],
    ["الأستاذ", exported.professorName],
    ["تاريخ المحاضرة", exportDate(exported.date)],
    ["وقت المحاضرة", exportDateTime(exported.date)],
    ["حد الحضور %", exported.attendanceLimit],
    ["الملخص", summaryLine(exported)],
    [],
  ];

  const body: Cell[][] = exported.rows.map((row) => [
    row.serial,
    row.fullName,
    row.universityId,
    row.academicYear,
    row.departmentName,
    row.specializationName,
    row.status ? statusLabels[row.status] : missingLabel,
    row.reason,
    row.recordedAt ? exportDateTime(row.recordedAt) : null,
  ]);

  const sheet = buildSheet(
    [...info, sessionHeaders, ...body],
    [12, 30, 18, 10, 26, 26, 12, 26, 22],
  );

  XLSX.utils.book_append_sheet(workbook, sheet, "سجل المحاضرة");
  return workbook;
}

/**
 * Every lecture of a subject as one grid: students down, dates across.
 *
 * Each lecture takes two columns. The first holds the final state as a single
 * word, the second the reason, which is only ever filled for an excuse. Dates sit
 * on their own row above the header so each pair of columns is titled by the day it
 * belongs to; merging the date into the header cell instead would make every column
 * read as the same lecture.
 */
export function buildAttendanceMatrixWorkbook(matrix: AttendanceMatrix) {
  const workbook = XLSX.utils.book_new();

  const info: Cell[][] = [
    ["المادة", `${matrix.subjectName} (${matrix.subjectCode})`],
    ["الأستاذ", matrix.professorName ?? "—"],
    ["عدد المحاضرات", matrix.sessionsCount],
    ["عدد الطلاب", matrix.studentsCount],
    ["حد الحضور %", matrix.attendanceLimit],
    ["الملخص", summaryLine(matrix)],
    [],
  ];

  /**
   * A merged cell above each pair of columns, so one date spans the state and the
   * reason it covers. SheetJS only stores the top-left value of a merge, so the
   * date is written once and the partner column is left empty.
   */
  const dates: Cell[] = [...identityHeaders.map(() => null)];
  const stateTitles: Cell[] = [...identityHeaders];
  const reasonTitles: Cell[] = [...identityHeaders.map(() => null)];
  const merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] = [];

  matrix.columns.forEach((column, index) => {
    const stateColumn = identityHeaders.length + index * 2;
    dates.push(exportDate(column.date));
    dates.push(null);
    stateTitles.push(column.title ?? "بدون عنوان");
    stateTitles.push(null);
    reasonTitles.push(null);
    reasonTitles.push(matrixColumnLabels.reason);
    merges.push({
      s: { r: DATES_ROW, c: stateColumn },
      e: { r: DATES_ROW, c: stateColumn + 1 },
    });
  });

  for (const label of matrixSummaryHeaders) {
    dates.push(null);
    stateTitles.push(label);
    reasonTitles.push(null);
  }

  const totals: Cell[] = [
    "الإجمالي",
    null, null, null, null, null,
    ...matrix.columns.flatMap(() => [null, null]),
    ...matrixSummaryHeaders.map(() => null),
  ];

  const body: Cell[][] = matrix.rows.map((row) => {
    const cells: Cell[] = [];

    for (const column of matrix.columns) {
      const status = row.statuses.get(column.sessionId);
      cells.push(status ? statusLabels[status] : null);
      // The reason only belongs to an excuse, so the two cells never contradict
      // each other.
      cells.push(status === "EXCUSED" ? (row.reasons.get(column.sessionId) ?? null) : null);
    }

    let present = 0;
    let absent = 0;
    let excused = 0;
    for (const status of row.statuses.values()) {
      if (status === "PRESENT") present += 1;
      else if (status === "ABSENT") absent += 1;
      else excused += 1;
    }

    const counted = present + absent;

    cells.push(
      present,
      absent,
      excused,
      // A number, not a formatted string, so the column totals and any chart in
      // Excel work on it.
      exportPercentNumber(counted > 0 ? (present / counted) * 100 : null),
    );

    return [
      row.serial,
      row.fullName,
      row.universityId,
      row.academicYear,
      row.departmentName,
      row.specializationName,
      ...cells,
    ];
  });

  const sheet = buildSheet(
    [...info, dates, stateTitles, reasonTitles, totals, ...body],
    [
      12, 30, 18, 10, 24, 24,
      ...matrix.columns.flatMap(() => [13, 22]),
      10, 10, 10, 14,
    ],
  );

  if (merges.length > 0) sheet["!merges"] = merges;

  XLSX.utils.book_append_sheet(workbook, sheet, matrix.subjectCode || "الحضور");
  return workbook;
}

/** Rows kept on screen: the info block, the date row, the header and the totals. */
export function sessionFrozenRows() {
  return 9;
}

export function matrixFrozenRows() {
  return TOTALS_ROW + 1;
}

export { INFO_END_ROW, DATES_ROW, STATE_TITLES_ROW, REASON_TITLES_ROW, TOTALS_ROW };

export function workbookToBuffer(workbook: XLSX.WorkBook) {
  const data = XLSX.write(workbook, { type: "buffer", bookType: "xlsx", compression: true });
  return Buffer.isBuffer(data) ? data : Buffer.from(data);
}

/**
 * Writes the workbook and pins the header rows.
 *
 * `rowsToFreeze` is applied after serialisation because SheetJS drops the pane
 * definition when writing; see `lib/xlsx-freeze`.
 */
export function writeFrozenWorkbook(workbook: XLSX.WorkBook, rowsToFreeze: number) {
  return freezeTopRows(workbookToBuffer(workbook), rowsToFreeze);
}

/**
 * `ArrayBuffer` rather than the Node `Buffer`: a Buffer is a Uint8Array view, which
 * the Response body type does not accept in this project's TS lib configuration.
 */
export function xlsxResponse(buffer: Buffer, fileName: string) {
  const body = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;

  return new Response(body, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"; filename*=UTF-8''${fileName}`,
      "Cache-Control": "no-store",
    },
  });
}

export { exportDate, exportDateTime };