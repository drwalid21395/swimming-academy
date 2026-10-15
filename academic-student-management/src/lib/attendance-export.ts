import { AttendanceStatus, Prisma } from "@prisma/client";

import { percentOf } from "@/lib/format";
import { prisma } from "@/lib/prisma";

export type AttendanceExportScope = { subjectIds?: string[] };

/**
 * Cell values in the sheet, kept short on purpose: a wide column per lecture is
 * already hard to read, and an Arabic word fits a phone screenshot better than an
 * English enum.
 */
export const statusLabels: Record<AttendanceStatus, string> = {
  PRESENT: "حاضر",
  ABSENT: "غائب",
  EXCUSED: "بعذر",
};

/** Shown when the student was enrolled but nobody recorded them. */
export const missingLabel = "لم يُسجَّل";

/**
 * Arabic name order, matching the on-screen roster.
 *
 * `Intl.Collator` sorts Arabic letters correctly; a plain `<` comparison uses code
 * point order, which shuffles the names.
 */
const nameCollator = new Intl.Collator("ar", { sensitivity: "base", numeric: true });

function compareByName<T extends { fullName: string }>(a: T, b: T) {
  return nameCollator.compare(a.fullName, b.fullName);
}

export type SessionExportRow = {
  serial: string | null;
  fullName: string;
  universityId: string;
  academicYear: number;
  departmentName: string;
  specializationName: string | null;
  status: AttendanceStatus | null;
  reason: string | null;
  /** When the record was last written, so the sheet carries the capture time. */
  recordedAt: Date | null;
};

export type SessionExport = {
  subjectName: string;
  subjectCode: string;
  professorName: string;
  title: string | null;
  date: Date;
  attendanceLimit: number;
  rows: SessionExportRow[];
  present: number;
  absent: number;
  excused: number;
  missing: number;
};

/**
 * Every student enrolled in the session, not just the ones already marked.
 *
 * Exporting only the stored records would silently drop students who were present
 * in the lecture but never registered, which is exactly the case a lecturer needs
 * to see when checking a sheet.
 */
export async function getSessionAttendanceExport(
  sessionId: string,
  scope?: AttendanceExportScope,
): Promise<SessionExport | null> {
  const session = await prisma.attendanceSession.findFirst({
    where: {
      id: sessionId,
      ...(scope?.subjectIds ? { subjectId: { in: scope.subjectIds } } : {}),
    },
    select: {
      id: true,
      date: true,
      title: true,
      subject: {
        select: {
          id: true,
          name: true,
          code: true,
          attendanceLimit: true,
          professors: {
            where: { isPrimary: true },
            take: 1,
            select: { professor: { select: { user: { select: { fullName: true } } } } },
          },
        },
      },
      createdBy: { select: { user: { select: { fullName: true } } } },
    },
  });

  if (!session) return null;

  /**
   * The roster and the records are read as two flat queries rather than one nested
   * include.
   *
   * A nested `enrollments.orderBy.student.user.fullName` is a relation sort, which
   * Prisma cannot turn into an index scan: the whole roster is loaded and sorted in
   * the function, and the page stalls long enough for the browser to report it as
   * unresponsive. Sorting the already-materialised array below costs nothing.
   */
  const [enrollments, records] = await Promise.all([
    prisma.enrollment.findMany({
      where: { subjectId: session.subject.id, status: "ACTIVE" },
      select: {
        student: {
          select: {
            id: true,
            serial: true,
            universityId: true,
            academicYear: true,
            user: { select: { fullName: true } },
            department: { select: { name: true } },
            specialization: { select: { name: true } },
          },
        },
      },
    }),
    prisma.attendanceRecord.findMany({
      where: { sessionId: session.id },
      select: { studentId: true, status: true, reason: true, updatedAt: true },
    }),
  ]);

  const recordByStudent = new Map(records.map((record) => [record.studentId, record]));

  const rows: SessionExportRow[] = enrollments
    .map((enrollment) => {
      const student = enrollment.student;
      const record = recordByStudent.get(student.id);

      return {
        serial: student.serial,
        fullName: student.user.fullName,
        universityId: student.universityId,
        academicYear: student.academicYear,
        departmentName: student.department.name,
        specializationName: student.specialization?.name ?? null,
        status: record?.status ?? null,
        reason: record?.reason ?? null,
        recordedAt: record?.updatedAt ?? null,
      };
    })
    .sort(compareByName);

  let present = 0;
  let absent = 0;
  let excused = 0;
  for (const row of rows) {
    if (row.status === "PRESENT") present += 1;
    else if (row.status === "ABSENT") absent += 1;
    else if (row.status === "EXCUSED") excused += 1;
  }

  return {
    subjectName: session.subject.name,
    subjectCode: session.subject.code,
    professorName:
      session.subject.professors[0]?.professor.user.fullName ?? session.createdBy.user.fullName,
    title: session.title,
    date: session.date,
    attendanceLimit: session.subject.attendanceLimit,
    rows,
    present,
    absent,
    excused,
    missing: rows.length - present - absent - excused,
  };
}

export type MatrixColumn = {
  sessionId: string;
  date: Date;
  title: string | null;
};

export type MatrixRow = {
  studentId: string;
  serial: string | null;
  fullName: string;
  universityId: string;
  academicYear: number;
  departmentName: string;
  specializationName: string | null;
  /** Keyed by `sessionId`: the final state of that lecture. */
  statuses: Map<string, AttendanceStatus>;
  /** Keyed by `sessionId`, only where the state is an excuse and a reason exists. */
  reasons: Map<string, string | null>;
};

export type AttendanceMatrix = {
  subjectName: string;
  subjectCode: string;
  professorName: string | null;
  attendanceLimit: number;
  columns: MatrixColumn[];
  rows: MatrixRow[];
  present: number;
  absent: number;
  excused: number;
  missing: number;
  sessionsCount: number;
  studentsCount: number;
};

/**
 * The combined sheet: one row per student, one column per lecture.
 *
 * Sessions are read newest first and every record for those sessions comes back in
 * a single query, then matched per student. Fetching the whole history per
 * student instead would issue one query per student and scale with the square of
 * the class size.
 */
export async function getAttendanceMatrixExport(
  subjectId: string,
  scope?: AttendanceExportScope,
): Promise<AttendanceMatrix | null> {
  const subject = await prisma.subject.findFirst({
    where: {
      id: subjectId,
      ...(scope?.subjectIds ? { id: { in: scope.subjectIds } } : {}),
    },
    select: {
      id: true,
      name: true,
      code: true,
      attendanceLimit: true,
      professors: {
        where: { isPrimary: true },
        take: 1,
        select: { professor: { select: { user: { select: { fullName: true } } } } },
      },
      attendance: {
        orderBy: { date: "asc" },
        select: { id: true, date: true, title: true },
      },
    },
  });

  if (!subject) return null;

  const columns: MatrixColumn[] = subject.attendance.map((session) => ({
    sessionId: session.id,
    date: session.date,
    title: session.title,
  }));

  /**
   * The roster is read on its own instead of nested inside the subject, for the same
   * reason as the single-lecture export: a relation sort on `user.fullName` is
   * resolved in the function over the whole roster, which is what stalled the page.
   */
  const enrollments = await prisma.enrollment.findMany({
    where: { subjectId: subject.id, status: "ACTIVE" },
    select: {
      student: {
        select: {
          id: true,
          serial: true,
          universityId: true,
          academicYear: true,
          user: { select: { fullName: true } },
          department: { select: { name: true } },
          specialization: { select: { name: true } },
        },
      },
    },
  });

  const studentIds = enrollments.map((enrollment) => enrollment.student.id);

  /**
   * One flat read of the whole grid, restricted to the students on the roster.
   *
   * Nesting `records` inside each session would return the history of every
   * student who ever attended, including those no longer enrolled, and the sheet
   * cannot use any of those cells.
   */
  const records = studentIds.length
    ? await prisma.attendanceRecord.findMany({
        where: {
          studentId: { in: studentIds },
          sessionId: { in: columns.map((column) => column.sessionId) },
        },
        select: { sessionId: true, studentId: true, status: true, reason: true },
      })
    : [];

  /**
   * Both halves of a cell in one map: the status decides the first sub-column and
   * the reason, when the status is an excuse, the second. Keeping them together
   * avoids a second lookup per cell while the sheet is being assembled.
   */
  const cellByKey = new Map<string, { status: AttendanceStatus; reason: string | null }>();
  for (const record of records) {
    cellByKey.set(`${record.sessionId}:${record.studentId}`, {
      status: record.status,
      reason: record.reason ?? null,
    });
  }

  const rows: MatrixRow[] = enrollments
    .map((enrollment) => {
      const student = enrollment.student;

      const statuses = new Map<string, AttendanceStatus>();
      const reasons = new Map<string, string | null>();

      for (const column of columns) {
        const cell = cellByKey.get(`${column.sessionId}:${student.id}`);
        if (!cell) continue;
        statuses.set(column.sessionId, cell.status);
        // Only an excuse carries a reason worth showing; a blank cell under a
        // "حاضر" status would only make the sheet harder to scan.
        if (cell.status === "EXCUSED" && cell.reason) reasons.set(column.sessionId, cell.reason);
      }

      return {
        studentId: student.id,
        serial: student.serial,
        fullName: student.user.fullName,
        universityId: student.universityId,
        academicYear: student.academicYear,
        departmentName: student.department.name,
        specializationName: student.specialization?.name ?? null,
        statuses,
        reasons,
      };
    })
    .sort(compareByName);

  let present = 0;
  let absent = 0;
  let excused = 0;
  for (const row of rows) {
    for (const status of row.statuses.values()) {
      if (status === "PRESENT") present += 1;
      else if (status === "ABSENT") absent += 1;
      else excused += 1;
    }
  }

  const recorded = present + absent + excused;

  return {
    subjectName: subject.name,
    subjectCode: subject.code,
    professorName: subject.professors[0]?.professor.user.fullName ?? null,
    attendanceLimit: subject.attendanceLimit,
    columns,
    rows,
    present,
    absent,
    excused,
    // An unenrolled student simply has no cell for that lecture, so "missing" is
    // the full grid minus what was recorded, which is what the totals line shows.
    missing: rows.length * columns.length - recorded,
    sessionsCount: columns.length,
    studentsCount: rows.length,
  };
}

/** Percentage helper shared by both exports' summary rows. */
export function exportPercentage(part: number, total: number) {
  return percentOf(part, total);
}

/** The `where` a caller should reuse when it needs the same subject scope. */
export function subjectScopeWhere(
  scope?: AttendanceExportScope,
): Prisma.AttendanceSessionWhereInput {
  return scope?.subjectIds ? { subjectId: { in: scope.subjectIds } } : {};
}