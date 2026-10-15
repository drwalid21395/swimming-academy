/**
 * Sorting for the students table, kept free of Prisma and React so it can be
 * reasoned about and tested on its own.
 */

export const STUDENT_SORT_FIELDS = [
  "serial",
  "fullName",
  "email",
  "universityId",
  "department",
  "specialization",
  "academicYear",
  "subjectsCount",
  "isActive",
] as const;

export type StudentSortField = (typeof STUDENT_SORT_FIELDS)[number];

export type StudentSort = { field: StudentSortField; dir: "asc" | "desc" };

export const DEFAULT_STUDENT_SORT: StudentSortField = "serial";

export function resolveStudentSort(
  sortBy: string | undefined,
  sortDir: "asc" | "desc" | undefined,
): StudentSort {
  const field = STUDENT_SORT_FIELDS.includes(sortBy as StudentSortField)
    ? (sortBy as StudentSortField)
    : DEFAULT_STUDENT_SORT;

  return { field, dir: sortDir === "desc" ? "desc" : "asc" };
}

/** Flips the direction when the same column is chosen again. */
export function nextStudentSort(current: StudentSort, field: StudentSortField): StudentSort {
  if (current.field !== field) return { field, dir: "asc" };
  return { field, dir: current.dir === "asc" ? "desc" : "asc" };
}

/**
 * `"ar"` keeps Arabic and Latin names in one readable order, and it treats digits
 * as numbers, so student 9 sorts before student 10.
 */
/**
 * `ar` keeps Arabic and Latin names in one readable order. `numeric` is what
 * makes 2 sort before 10 and 2026002 before 20260010; plain `localeCompare`
 * compares digits as letters and puts "10" before "2". `sensitivity: "base"`
 * ignores case and diacritics so a stray hamza or capital does not scatter the
 * list.
 *
 * Built once, because a row is compared many times per sort.
 */
const collator = new Intl.Collator("ar", { numeric: true, sensitivity: "base" });

function compareText(a: string | null | undefined, b: string | null | undefined) {
  return collator.compare(String(a ?? ""), String(b ?? ""));
}

/** The minimum a row has to provide for the sortable columns. */
export type SortableStudent = {
  id: string;
  serial: string | null;
  fullName: string;
  email: string;
  universityId: string;
  academicYear: number;
  departmentName: string;
  specializationName: string | null;
  subjectsCount: number;
  isActive: boolean;
};

function compareBy(a: SortableStudent, b: SortableStudent, field: StudentSortField) {
  switch (field) {
    case "serial":
      return compareText(a.serial, b.serial);
    case "fullName":
      return compareText(a.fullName, b.fullName);
    case "email":
      return compareText(a.email, b.email);
    case "universityId":
      return compareText(a.universityId, b.universityId);
    case "department":
      return compareText(a.departmentName, b.departmentName);
    case "specialization":
      return compareText(a.specializationName, b.specializationName);
    case "academicYear":
      return a.academicYear - b.academicYear;
    case "subjectsCount":
      return a.subjectsCount - b.subjectsCount;
    case "isActive":
      return Number(a.isActive) - Number(b.isActive);
  }
}

/**
 * Sorts in place. Attendance and the subject count are computed after the query,
 * so every column is compared here instead of mixing database ordering with
 * in-memory ordering, which would only stay correct for some of the columns.
 */
export function sortStudents<T extends SortableStudent>(rows: T[], sort: StudentSort): T[] {
  const sign = sort.dir === "desc" ? -1 : 1;

  const tieBreak = (a: T, b: T) =>
    // A stable tie breaker keeps paging from repeating or skipping a row when
    // several students share the sorted value.
    compareText(a.fullName, b.fullName) || compareText(a.id, b.id);

  return rows.sort((a, b) => {
    // A student with no serial on record is not "smaller" or "bigger" than one
    // that has it, so those rows sink to the bottom in both directions. Decided
    // before the sign flip, otherwise descending would promote them to the top.
    if (sort.field === "serial") {
      const unknownA = !a.serial;
      const unknownB = !b.serial;
      if (unknownA !== unknownB) return unknownA ? 1 : -1;
      if (unknownA && unknownB) return tieBreak(a, b);
    }

    const compared = compareBy(a, b, sort.field);
    if (compared !== 0) return sign * compared;

    return tieBreak(a, b);
  });
}