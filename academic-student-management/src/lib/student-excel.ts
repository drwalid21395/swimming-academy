export type StudentExcelKey =
  | "serial"
  | "fullName"
  | "email"
  | "universityId"
  | "phone"
  | "department"
  | "specialization"
  | "academicYear"
  | "password";

export type StudentExcelColumn = {
  key: StudentExcelKey;
  label: string;
  required: boolean;
};

/**
 * Single source of truth for every student import/export column. The empty
 * template, the upload parser and the import validation all read from this
 * list, so the downloadable file always matches the editable student fields.
 *
 * `serial` is the roster number carried by the student. It is stored on the
 * student so the table and the attendance sheet can show and sort by it, and it
 * is kept optional and non-unique so a blank or repeated value never fails an
 * import.
 *
 * Only `fullName` and `department` are mandatory. The rest are optional: blank
 * emails and university ids are filled with a generated unique value, and a
 * blank academic year falls back to the first year.
 */
export const studentTemplateColumns: StudentExcelColumn[] = [
  { key: "serial", label: "رقم المسلسل", required: false },
  { key: "fullName", label: "الاسم الكامل", required: true },
  { key: "email", label: "البريد الإلكتروني", required: false },
  { key: "universityId", label: "الرقم الجامعي", required: false },
  { key: "phone", label: "رقم الهاتف", required: false },
  { key: "department", label: "القسم", required: true },
  { key: "specialization", label: "التخصص", required: false },
  { key: "academicYear", label: "الفرقة", required: false },
  { key: "password", label: "كلمة المرور", required: false },
];

export const studentTemplateSheetName = "الطلاب";

/** Used when the password column is left empty for a newly imported student. */
export const studentDefaultPassword = "12345678";

export const studentTemplateColumnsLabels = studentTemplateColumns.map((column) => column.label);

export function normalizeHeaderLabel(value: string) {
  return value.trim().replace(/\s+/g, "").toLowerCase();
}

/** Em dash and en dash accepted as the code/name separator in imported files. */
const labelSeparators = ["\u2014", "\u2013"];

/** Builds the "CODE — NAME" entry shown in the template dropdowns. */
export function templateOptionLabel(code: string, name: string) {
  return `${code} \u2014 ${name}`;
}

/**
 * Turns a cell value into the candidates worth looking up in the database.
 * The template writes "CODE — NAME", but a cell may also hold just a code or
 * just a name, so every part is offered as a candidate.
 */
export function splitTemplateOptionLabel(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) return [];

  const candidates = [trimmed];
  for (const separator of labelSeparators) {
    const at = trimmed.indexOf(separator);
    if (at === -1) continue;
    const before = trimmed.slice(0, at).trim();
    const after = trimmed.slice(at + 1).trim();
    if (before) candidates.push(before);
    if (after) candidates.push(after);
  }

  return [...new Set(candidates)];
}