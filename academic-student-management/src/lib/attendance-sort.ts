/**
 * Sorting for the attendance sheet, kept free of Prisma and React so it can be
 * reasoned about and tested on its own.
 *
 * It mirrors `student-sort.ts` on purpose: the students table learned that the
 * database collation and the Arabic collation disagree, so every column is
 * compared here instead of relying on `orderBy`.
 */

export const ATTENDANCE_SORT_FIELDS = [
  "serial",
  "fullName",
  "universityId",
  "department",
  "specialization",
  "academicYear",
  "attendance",
] as const;

export type AttendanceSortField = (typeof ATTENDANCE_SORT_FIELDS)[number];

export type AttendanceSort = { field: AttendanceSortField; dir: "asc" | "desc" };

export const DEFAULT_ATTENDANCE_SORT: AttendanceSortField = "serial";

export function resolveAttendanceSort(
  sortBy: string | undefined,
  sortDir: "asc" | "desc" | undefined,
): AttendanceSort {
  const field = ATTENDANCE_SORT_FIELDS.includes(sortBy as AttendanceSortField)
    ? (sortBy as AttendanceSortField)
    : DEFAULT_ATTENDANCE_SORT;

  return { field, dir: sortDir === "desc" ? "desc" : "asc" };
}

/** Flips the direction when the same column is chosen again. */
export function nextAttendanceSort(
  current: AttendanceSort,
  field: AttendanceSortField,
): AttendanceSort {
  if (current.field !== field) return { field, dir: "asc" };
  return { field, dir: current.dir === "asc" ? "desc" : "asc" };
}

/**
 * `ar` keeps Arabic and Latin names in one readable order. `numeric` is what
 * makes 2 sort before 10 and 2026002 before 20260010; plain `localeCompare`
 * compares digits as letters and puts "10" before "2".
 *
 * Built once, because a row is compared many times per sort.
 */
const collator = new Intl.Collator("ar", { numeric: true, sensitivity: "base" });

function compareText(a: string | null | undefined, b: string | null | undefined) {
  return collator.compare(String(a ?? ""), String(b ?? ""));
}

/** The minimum a row has to provide for the sortable columns. */
export type SortableSheetRow = {
  studentId: string;
  serial: string | null;
  fullName: string;
  universityId: string;
  academicYear: number;
  departmentName: string;
  specializationName: string | null;
  attendancePercentage: number | null;
};

/**
 * A missing serial, a missing specialisation, or a percentage with no attendance
 * history behind it is not a value that can honestly be called bigger or smaller
 * than a real one.
 */
function isUnknown(field: AttendanceSortField, row: SortableSheetRow) {
  if (field === "serial") return !row.serial;
  if (field === "specialization") {
    return row.specializationName === null || row.specializationName === "";
  }
  if (field === "attendance") return row.attendancePercentage === null;
  return false;
}

function tieBreak(a: SortableSheetRow, b: SortableSheetRow) {
  // A stable tie breaker keeps two students with the same value from swapping
  // places between renders.
  return compareText(a.fullName, b.fullName) || compareText(a.studentId, b.studentId);
}

function compareBy(a: SortableSheetRow, b: SortableSheetRow, field: AttendanceSortField) {
  switch (field) {
    case "serial":
      return compareText(a.serial, b.serial);
    case "fullName":
      return compareText(a.fullName, b.fullName);
    case "universityId":
      return compareText(a.universityId, b.universityId);
    case "department":
      return compareText(a.departmentName, b.departmentName);
    case "specialization":
      return compareText(a.specializationName, b.specializationName);
    case "academicYear":
      return a.academicYear - b.academicYear;
    case "attendance":
      return (a.attendancePercentage ?? 0) - (b.attendancePercentage ?? 0);
  }
}

/**
 * Sorts in place. `attendancePercentage` is computed after the query, so it is
 * compared here rather than pushed into an `orderBy` that could not express it.
 */
export function sortSheetRows<T extends SortableSheetRow>(rows: T[], sort: AttendanceSort): T[] {
  const sign = sort.dir === "desc" ? -1 : 1;

  return rows.sort((a, b) => {
    // Missing values sink to the bottom in both directions. This is decided
    // before the sign flip, otherwise descending would promote them to the top.
    const unknownA = isUnknown(sort.field, a);
    const unknownB = isUnknown(sort.field, b);
    if (unknownA !== unknownB) return unknownA ? 1 : -1;
    if (unknownA && unknownB) return tieBreak(a, b);

    const compared = compareBy(a, b, sort.field);
    if (compared !== 0) return sign * compared;

    return tieBreak(a, b);
  });
}