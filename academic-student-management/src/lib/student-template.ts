import * as XLSX from "xlsx";

import { CFB } from "@/lib/xlsx-cfb";
import {
  studentTemplateColumns,
  studentTemplateSheetName,
  templateOptionLabel,
  type StudentExcelKey,
} from "@/lib/student-excel";

export type TemplateDepartment = { id: string; name: string; code: string };
export type TemplateSpecialization = { departmentId: string; name: string; code: string };

/** Hidden sheet that holds the values every dropdown points at. */
const listsSheetName = "Lists";
const departmentListName = "L_DEPT_LIST";
const specializationNamePrefix = "L_SPEC_";
/** Dash separating a code from a name in a dropdown label. */
const firstDataRow = 2;
const lastDataRow = 1000;
/** Excel allows 16384 columns; this is a sanity ceiling on departments per file. */
const maxDepartments = 500;

function columnLetter(index: number) {
  let name = "";
  let current = index;
  while (current >= 0) {
    name = String.fromCharCode(65 + (current % 26)) + name;
    current = Math.floor(current / 26) - 1;
  }
  return name;
}

/**
 * Department keys used inside the `L_SPEC_*` defined names. The dropdown resolves
 * a department with `MATCH`, which yields its row number, so the name is always a
 * plain integer and can never disagree with the formula the way a code-derived
 * name would once a code contains `-` or `/`.
 */
function specializationListName(position: number) {
  return `${specializationNamePrefix}${position}`;
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Child order of `CT_Worksheet` per ECMA-376. Excel discards the whole sheet
 * when the elements appear in any other order, so the dropdown block is
 * inserted at the position this list dictates rather than simply appended.
 */
const worksheetChildOrder = [
  "sheetPr", "dimension", "sheetViews", "sheetFormatPr", "cols", "sheetData",
  "sheetCalcPr", "sheetProtection", "protectedRanges", "scenarios", "autoFilter",
  "sortState", "dataConsolidate", "customSheetViews", "mergeCells", "phoneticPr",
  "conditionalFormatting", "dataValidations", "hyperlinks", "printOptions",
  "pageMargins", "pageSetup", "headerFooter", "rowBreaks", "colBreaks",
  "customProperties", "cellWatches", "ignoredErrors", "smartTags", "drawing",
  "legacyDrawing", "legacyDrawingHF", "drawingHF", "picture", "oleObjects",
  "controls", "webPublishItems", "tableParts", "extLst",
];

const elementsAfterDataValidations = worksheetChildOrder
  .slice(worksheetChildOrder.indexOf("dataValidations") + 1)
  .map((name) => `<${name}`);

function injectDataValidations(sheetXml: string, block: string) {
  if (sheetXml.includes("<dataValidations")) return sheetXml;

  // Insert before the earliest element the schema places after dataValidations.
  let insertAt = -1;
  for (const tag of elementsAfterDataValidations) {
    const at = sheetXml.indexOf(tag);
    if (at !== -1 && (insertAt === -1 || at < insertAt)) insertAt = at;
  }

  if (insertAt === -1) {
    const close = sheetXml.lastIndexOf("</worksheet>");
    if (close === -1) throw new Error("تعذر تحديد نهاية ورقة الطلاب في ملف الإكسل.");
    return `${sheetXml.slice(0, close)}${block}${sheetXml.slice(close)}`;
  }

  return `${sheetXml.slice(0, insertAt)}${block}${sheetXml.slice(insertAt)}`;
}

function buildDataValidationsBlock(departmentColumn: string, specializationColumn: string) {
  const departmentValidation =
    `<dataValidation type="list" allowBlank="0" showInputMessage="1" showErrorMessage="1"` +
    ` promptTitle="القسم" prompt="اختر القسم من القائمة المنسدلة."` +
    ` errorTitle="قسم غير صحيح" error="اختر القسم من القائمة المنسدلة."` +
    ` sqref="${departmentColumn}${firstDataRow}:${departmentColumn}${lastDataRow}">` +
    `<formula1>${escapeXml(departmentListName)}</formula1></dataValidation>`;

  // Excel stores one formula per rule and evaluates it relative to the active
  // cell, so a single INDIRECT rule stretched over F2:F1000 resolves to nothing
  // and the dropdown comes up empty. One rule per row, with an absolute
  // reference, is what makes the dependent list actually populate.
  const specializationValidations: string[] = [];
  for (let row = firstDataRow; row <= lastDataRow; row++) {
    // MATCH turns the picked department into its row number inside L_DEPT_LIST,
    // so the range name is numeric and never depends on the department code.
    const formula =
      `IFERROR(INDIRECT("${specializationNamePrefix}"&` +
      `MATCH($${departmentColumn}${row},${departmentListName},0)),"")`;
    specializationValidations.push(
      `<dataValidation type="list" allowBlank="1" showInputMessage="0" showErrorMessage="0"` +
      ` sqref="${specializationColumn}${row}">` +
      `<formula1>${escapeXml(formula)}</formula1></dataValidation>`,
    );
  }

  const count = 1 + specializationValidations.length;
  return (
    `<dataValidations count="${count}">${departmentValidation}` +
    `${specializationValidations.join("")}</dataValidations>`
  );
}

function columnLetterForKey(key: string) {
  const index = studentTemplateColumns.findIndex((column) => column.key === key);
  if (index === -1) throw new Error(`عمود غير معروف في قالب الطلاب: ${key}`);
  return columnLetter(index);
}

/**
 * Builds the downloadable template: the student sheet plus a hidden sheet
 * holding every department and its specializations, wired to the cells through
 * named ranges so the specialization dropdown follows the chosen department.
 */
export function buildStudentTemplateWorkbook(
  departments: TemplateDepartment[],
  specializations: TemplateSpecialization[],
) {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    studentTemplateColumns.map((column) => column.label),
  ]);

  // Keyed by column so a new field never ends up with someone else's width.
  const columnWidths: Partial<Record<StudentExcelKey, number>> = {
    serial: 12,
    fullName: 30,
    email: 32,
    universityId: 20,
    phone: 16,
    department: 28,
    specialization: 32,
    academicYear: 10,
    password: 18,
  };

  sheet["!cols"] = studentTemplateColumns.map((column) => ({
    wch: columnWidths[column.key] ?? 18,
  }));

  XLSX.utils.book_append_sheet(workbook, sheet, studentTemplateSheetName);

  const usable = departments.slice(0, maxDepartments);

  const byDepartment = new Map<string, string[]>(usable.map((department) => [department.id, []]));
  for (const specialization of specializations) {
    byDepartment
      .get(specialization.departmentId)
      ?.push(templateOptionLabel(specialization.code, specialization.name));
  }

  // Row 1 holds the headers the defined names point below; each following row
  // holds one department/specialization pair per column. The sheet stays
  // rectangular, but every named range is sized to its own column so the
  // dropdowns never offer a blank trailing entry.
  const specializationDepth = Math.max(0, ...[...byDepartment.values()].map((list) => list.length));
  const depth = Math.max(usable.length, specializationDepth, 1);
  const listsRows: string[][] = [["__code", "__label", ...usable.map((department) => department.code)]];
  for (let row = 0; row < depth; row++) {
    listsRows.push([
      usable[row]?.code ?? "",
      usable[row] ? templateOptionLabel(usable[row].code, usable[row].name) : "",
      ...usable.map((department) => byDepartment.get(department.id)?.[row] ?? ""),
    ]);
  }

  const listsSheet = XLSX.utils.aoa_to_sheet(listsRows);
  XLSX.utils.book_append_sheet(workbook, listsSheet, listsSheetName);

  const lastDepartmentRow = 1 + usable.length;
  const names = [
    {
      Name: departmentListName,
      Ref: `${listsSheetName}!$B$2:$B$${lastDepartmentRow}`,
    },
    ...usable.map((department, index) => {
      const letter = columnLetter(2 + index);
      // A department with no specializations still needs a valid range: "F2:F1"
      // is inverted, which Excel rejects, so the range is clamped to one empty
      // cell and the dropdown simply offers nothing.
      const lastRow = Math.max(firstDataRow, 1 + (byDepartment.get(department.id)?.length ?? 0));
      return {
        // Positional, so the name matches what MATCH() builds at runtime.
        Name: specializationListName(index + 1),
        Ref: `${listsSheetName}!$${letter}$${firstDataRow}:$${letter}$${lastRow}`,
      };
    }),
  ];

  workbook.Workbook = {
    Sheets: [{ Hidden: 0 }, { Hidden: 1 }],
    Names: names,
  };

  return workbook;
}

/**
 * SheetJS cannot write data validation, so the two dropdowns are injected into
 * the worksheet XML after the workbook has been serialised. The result is still
 * a normal xlsx file that any spreadsheet application reads.
 */
export function addStudentTemplateDropdowns(buffer: Buffer) {
  const cfb = CFB.read(buffer, { type: "buffer" });

  const sheetPath = "/xl/worksheets/sheet1.xml";
  let index = cfb.FullPaths.indexOf(sheetPath);
  if (index === -1) {
    index = cfb.FullPaths.findIndex((path: string) =>
      path.replace(/^\//, "").endsWith("worksheets/sheet1.xml"),
    );
  }

  const entry = cfb.FileIndex[index];
  if (!entry) throw new Error("تعذر الوصول إلى ورقة الطلاب داخل ملف الإكسل.");

  const xml = Buffer.from(entry.content).toString("utf8");
  const departmentColumn = columnLetterForKey("department");
  const specializationColumn = columnLetterForKey("specialization");
  const patched = injectDataValidations(
    xml,
    buildDataValidationsBlock(departmentColumn, specializationColumn),
  );

  cfb.FileIndex[index].content = Buffer.from(patched, "utf8");

  const written = CFB.write(cfb, {
    fileType: "zip",
    type: "buffer",
    compression: true,
  });

  return Buffer.isBuffer(written) ? written : Buffer.from(written);
}
