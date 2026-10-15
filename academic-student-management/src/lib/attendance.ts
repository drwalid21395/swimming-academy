import { AttendanceStatus, Prisma } from "@prisma/client";
import { z } from "zod";

import {
  summarizeAttendanceCounts,
  type AttendanceSummary,
} from "@/lib/dashboard-data";
import { prisma } from "@/lib/prisma";

export const attendanceStatusEnum = z.enum(["PRESENT", "ABSENT", "EXCUSED"]);

export const sessionFormSchema = z.object({
  subjectId: z.string().min(1, "المادة مطلوبة."),
  createdById: z.string().min(1, "عضو هيئة التدريس مطلوب."),
  date: z
    .string()
    .min(1, "تاريخ المحاضرة مطلوب.")
    .regex(/^\d{4}-\d{2}-\d{2}$/, "صيغة التاريخ يجب أن تكون YYYY-MM-DD."),
  title: z.string().trim().max(120).optional().or(z.literal("")),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
});

export type SessionFormValues = z.infer<typeof sessionFormSchema>;

export const recordEntrySchema = z.object({
  studentId: z.string().min(1),
  status: attendanceStatusEnum,
  reason: z.string().trim().max(200).optional(),
});

export const saveRecordsSchema = z.object({
  sessionId: z.string().min(1),
  entries: z.array(recordEntrySchema).min(1, "لا توجد سجلات للحفظ."),
});

export type SaveRecordsInput = z.infer<typeof saveRecordsSchema>;

export type AttendanceFilters = {
  query?: string;
  subjectId?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
};

export type AttendanceScope = { subjectIds?: string[] };

export type AttendanceSearchParams = Record<string, string | string[] | undefined>;

export type AttendanceSessionListItem = {
  id: string;
  date: Date;
  title: string | null;
  notes: string | null;
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  professorName: string;
  attendance: AttendanceSummary;
  markedCount: number;
  studentsCount: number;
};

export type AttendanceListResult = {
  rows: AttendanceSessionListItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  totalSessions: number;
  totalRecords: number;
  totalStudents: number;
  overall: AttendanceSummary;
  lowAttendance: LowAttendanceStudent[];
};

export type LowAttendanceStudent = {
  studentId: string;
  fullName: string;
  universityId: string;
  subjectId: string;
  subjectName: string;
  attendanceLimit: number;
  percentage: number;
  absentCount: number;
};

function readParam(params: AttendanceSearchParams, key: string) {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

function readNumber(value: string | undefined) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function startOfDay(value: string) {
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export function parseAttendanceFilters(params: AttendanceSearchParams): AttendanceFilters {
  const from = readParam(params, "from")?.trim();
  const to = readParam(params, "to")?.trim();

  return {
    query: readParam(params, "query")?.trim() || undefined,
    subjectId: readParam(params, "subjectId") || undefined,
    from: from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : undefined,
    to: to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : undefined,
    page: readNumber(readParam(params, "page")) ?? 1,
    pageSize: readNumber(readParam(params, "pageSize")) ?? 10,
  };
}

function buildWhere(
  filters: AttendanceFilters,
  scope?: AttendanceScope,
): Prisma.AttendanceSessionWhereInput {
  const query = filters.query?.trim();
  const from = filters.from ? startOfDay(filters.from) : undefined;
  const to = filters.to ? startOfDay(filters.to) : undefined;

  return {
    ...(scope?.subjectIds ? { subjectId: { in: scope.subjectIds } } : {}),
    ...(filters.subjectId ? { subjectId: filters.subjectId } : {}),
    ...(from || to
      ? {
          date: {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {}),
          },
        }
      : {}),
    ...(query
      ? {
          OR: [
            { title: { contains: query, mode: "insensitive" as const } },
            { subject: { name: { contains: query, mode: "insensitive" as const } } },
            { subject: { code: { contains: query, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };
}

/**
 * Counts are grouped by the database rather than read row by row.
 *
 * The previous version pulled every record of every session of every subject and
 * tallied them in JavaScript, so the page cost grew with sessions x students and
 * a long-running subject became the slowest thing in the app. `groupBy` returns
 * at most three rows per student regardless of how many lectures they attended,
 * and the remaining work is a lookup against the enrolled students.
 */
async function getLowAttendanceStudents(
  scope?: AttendanceScope,
  limit = 12,
): Promise<LowAttendanceStudent[]> {
  const subjectIds = scope?.subjectIds;

  const [subjects, counts] = await Promise.all([
    prisma.subject.findMany({
      where: subjectIds ? { id: { in: subjectIds } } : undefined,
      select: {
        id: true,
        name: true,
        attendanceLimit: true,
        enrollments: {
          where: { status: "ACTIVE" },
          select: {
            student: {
              select: {
                id: true,
                universityId: true,
                user: { select: { fullName: true } },
              },
            },
          },
        },
      },
    }),
    /**
     * Grouped by subject *and* student.
     *
     * `groupBy` cannot reach a relation field, so the counts come from one raw
     * query. Aggregating by `studentId` alone looked cheaper and was wrong: a
     * student enrolled in three subjects got one blended total, and that same
     * number was then reported as their attendance for each of the three
     * subjects separately.
     */
    prisma.$queryRaw<{
      subjectId: string;
      studentId: string;
      status: AttendanceStatus;
      count: bigint;
    }[]>`
      SELECT s."subjectId", r."studentId", r."status", COUNT(*) AS "count"
      FROM "AttendanceRecord" r
      JOIN "AttendanceSession" s ON s."id" = r."sessionId"
      ${subjectIds && subjectIds.length
        ? Prisma.sql`WHERE s."subjectId" IN (${Prisma.join(subjectIds)})`
        : Prisma.empty}
      GROUP BY s."subjectId", r."studentId", r."status"
    `,
  ]);

  /**
   * Keyed by subject first, so the per-subject percentage never borrows another
   * subject's records.
   */
  const countsBySubjectStudent = new Map<
    string,
    Map<string, { status: AttendanceStatus; count: number }[]>
  >();
  for (const row of counts) {
    let byStudent = countsBySubjectStudent.get(row.subjectId);
    if (!byStudent) {
      byStudent = new Map();
      countsBySubjectStudent.set(row.subjectId, byStudent);
    }
    const list = byStudent.get(row.studentId) ?? [];
    list.push({ status: row.status, count: Number(row.count) });
    byStudent.set(row.studentId, list);
  }

  const result: LowAttendanceStudent[] = [];

  for (const subject of subjects) {
    const byStudent = countsBySubjectStudent.get(subject.id);
    if (!byStudent) continue;

    for (const enrollment of subject.enrollments) {
      const summary = summarizeAttendanceCounts(byStudent.get(enrollment.student.id) ?? []);
      if (summary.percentage === null || summary.percentage >= subject.attendanceLimit) continue;

      result.push({
        studentId: enrollment.student.id,
        fullName: enrollment.student.user.fullName,
        universityId: enrollment.student.universityId,
        subjectId: subject.id,
        subjectName: subject.name,
        attendanceLimit: subject.attendanceLimit,
        percentage: summary.percentage,
        absentCount: summary.absent,
      });
    }
  }

  return result.sort((a, b) => a.percentage - b.percentage).slice(0, limit);
}

export async function listAttendanceSessions(
  filters: AttendanceFilters,
  scope?: AttendanceScope,
): Promise<AttendanceListResult> {
  const pageSize = Math.min(50, Math.max(5, filters.pageSize ?? 10));
  const page = Math.max(1, filters.page ?? 1);
  const where = buildWhere(filters, scope);
  const scopeWhere: Prisma.AttendanceSessionWhereInput = scope?.subjectIds
    ? { subjectId: { in: scope.subjectIds } }
    : {};

  /**
   * `getLowAttendanceStudents` is started with the rest rather than awaited at the
   * end: it is an independent aggregate, and running it afterwards added its whole
   * round trip to the time before the list could be painted.
   */
  const [total, totalSessions, totalStudents, sessions, overallRows, lowAttendance] =
    await Promise.all([
    prisma.attendanceSession.count({ where }),
    prisma.attendanceSession.count({ where: scopeWhere }),
    prisma.enrollment.count({
      where: { status: "ACTIVE", ...(scope?.subjectIds ? { subjectId: { in: scope.subjectIds } } : {}) },
    }),
    prisma.attendanceSession.findMany({
      where,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        date: true,
        title: true,
        notes: true,
        subject: {
          select: {
            id: true,
            name: true,
            code: true,
            enrollments: { where: { status: "ACTIVE" }, select: { id: true } },
            professors: {
              where: { isPrimary: true },
              take: 1,
              select: { professor: { select: { user: { select: { fullName: true } } } } },
            },
          },
        },
        createdBy: { select: { user: { select: { fullName: true } } } },
        records: { select: { status: true } },
      },
    }),
    prisma.attendanceRecord.groupBy({
      by: ["status"],
      _count: { _all: true },
      where: { session: scopeWhere },
    }),
    getLowAttendanceStudents(scope),
  ]);

  const rows: AttendanceSessionListItem[] = sessions.map((session) => ({
    id: session.id,
    date: session.date,
    title: session.title,
    notes: session.notes,
    subjectId: session.subject.id,
    subjectName: session.subject.name,
    subjectCode: session.subject.code,
    professorName:
      session.subject.professors[0]?.professor.user.fullName ??
      session.createdBy.user.fullName,
    attendance: summarizeAttendanceCounts(
      session.records.map((record) => ({ status: record.status, count: 1 })),
    ),
    markedCount: session.records.length,
    studentsCount: session.subject.enrollments.length,
  }));

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pageCount);

  return {
    rows,
    total,
    page: safePage,
    pageSize,
    pageCount,
    totalSessions,
    totalStudents,
    totalRecords: overallRows.reduce((sum, row) => sum + row._count._all, 0),
    overall: summarizeAttendanceCounts(
      overallRows.map((row) => ({ status: row.status, count: row._count._all })),
    ),
    lowAttendance,
  };
}

export type SessionOption = {
  id: string;
  name: string;
  code: string;
  studentsCount: number;
  primaryProfessorId: string | null;
};

export async function getSessionSubjects(scope?: AttendanceScope): Promise<SessionOption[]> {
  const subjects = await prisma.subject.findMany({
    where: scope?.subjectIds ? { id: { in: scope.subjectIds } } : undefined,
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      code: true,
      enrollments: { where: { status: "ACTIVE" }, select: { id: true } },
      professors: {
        where: { isPrimary: true },
        take: 1,
        select: { professorId: true },
      },
    },
  });

  return subjects.map((subject) => ({
    id: subject.id,
    name: subject.name,
    code: subject.code,
    studentsCount: subject.enrollments.length,
    primaryProfessorId: subject.professors[0]?.professorId ?? null,
  }));
}

export async function getSessionCreators() {
  return prisma.professor.findMany({
    orderBy: { user: { fullName: "asc" } },
    select: {
      id: true,
      employeeCode: true,
      departmentId: true,
      user: { select: { fullName: true, isActive: true } },
    },
  });
}

function toDateOnly(value: string) {
  return new Date(`${value}T00:00:00`);
}

export async function createSession(input: SessionFormValues, actorId: string) {
  const date = toDateOnly(input.date);
  const subjectId = input.subjectId;

  const [subject, professor] = await Promise.all([
    prisma.subject.findUnique({
      where: { id: subjectId },
      select: {
        id: true,
        code: true,
        name: true,
        enrollments: { where: { status: "ACTIVE" }, select: { id: true } },
      },
    }),
    prisma.professor.findUnique({ where: { id: input.createdById }, select: { id: true } }),
  ]);

  if (!subject) throw new Error("المادة غير موجودة.");
  if (!professor) throw new Error("عضو هيئة التدريس غير موجود.");
  if (subject.enrollments.length === 0) {
    throw new Error("لا يوجد طلاب مسجلون في هذه المادة. سجّل الطلاب أولاً.");
  }

  const clash = await prisma.attendanceSession.findUnique({
    where: { subjectId_date: { subjectId, date } },
    select: { id: true },
  });

  if (clash) throw new Error("يوجد محاضرة مسجلة لهذه المادة في نفس التاريخ.");

  const session = await prisma.$transaction(async (tx) => {
    const created = await tx.attendanceSession.create({
      data: {
        subjectId,
        createdById: input.createdById,
        date,
        title: input.title?.trim() ? input.title.trim() : null,
        notes: input.notes?.trim() ? input.notes.trim() : null,
      },
      select: { id: true, date: true, title: true },
    });

    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "attendance.create",
        entity: "AttendanceSession",
        entityId: created.id,
        metadata: { subject: subject.name, code: subject.code, date: input.date },
      },
    });

    return created;
  });

  return session;
}

export async function deleteSession(sessionId: string, actorId: string) {
  const session = await prisma.attendanceSession.findUnique({
    where: { id: sessionId },
    select: { id: true, date: true, title: true, subject: { select: { name: true } } },
  });

  if (!session) throw new Error("المحاضرة غير موجودة.");

  await prisma.$transaction(async (tx) => {
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "attendance.delete",
        entity: "AttendanceSession",
        entityId: session.id,
        metadata: { subject: session.subject.name, date: session.date.toISOString() },
      },
    });

    await tx.attendanceSession.delete({ where: { id: sessionId } });
  });
}

export type SheetRow = {
  studentId: string;
  serial: string | null;
  fullName: string;
  universityId: string;
  academicYear: number;
  departmentName: string;
  specializationName: string | null;
  status: AttendanceStatus | null;
  reason: string | null;
  overall: AttendanceSummary;
  isLow: boolean;
};

export type AttendanceSheet = {
  id: string;
  date: Date;
  title: string | null;
  notes: string | null;
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  attendanceLimit: number;
  professorName: string;
  createdAt: Date;
  rows: SheetRow[];
  markedCount: number;
  summary: AttendanceSummary;
  sessionsCount: number;
};

export async function getAttendanceSheet(
  sessionId: string,
  scope?: AttendanceScope,
): Promise<AttendanceSheet | null> {
  const session = await prisma.attendanceSession.findFirst({
    where: {
      id: sessionId,
      ...(scope?.subjectIds ? { subjectId: { in: scope.subjectIds } } : {}),
    },
    select: {
      id: true,
      subjectId: true,
      date: true,
      title: true,
      notes: true,
      createdAt: true,
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
          // Only the number of lectures is shown; loading every session row to count
          // them in JavaScript was pure overhead on a subject with a long history.
          _count: { select: { attendance: true } },
        },
      },
      createdBy: { select: { user: { select: { fullName: true } } } },
      records: { select: { studentId: true, status: true, reason: true } },
    },
  });

  if (!session) return null;

  const currentByStudent = new Map(session.records.map((record) => [record.studentId, record]));

  /**
   * The overall percentage is tallied with `groupBy` instead of reading the whole
   * history of the subject: the sheet only ever needs three counts per student,
   * and pulling every record of every lecture made opening a long-running subject
   * scale with sessions x students. The current sheet is excluded because its own
   * unsaved state is what the page is showing.
   */
  const counts = await prisma.attendanceRecord.groupBy({
    by: ["studentId", "status"],
    _count: { _all: true },
    where: {
      sessionId: { not: session.id },
      session: { subjectId: session.subjectId },
    },
  });

  const perStudent = new Map<string, { status: AttendanceStatus; count: number }[]>();
  for (const row of counts) {
    const list = perStudent.get(row.studentId) ?? [];
    list.push({ status: row.status, count: row._count._all });
    perStudent.set(row.studentId, list);
  }

  /**
   * The roster is read on its own, without a relation sort.
   *
   * `orderBy.student.user.fullName` cannot be pushed into an index scan, so Prisma
   * loaded every active enrollment and sorted it inside the request. The array is
   * already in memory here, so the same Arabic order is applied by
   * `sortSheetRows` on the client once the page mounts.
   */
  const enrollments = await prisma.enrollment.findMany({
    where: { subjectId: session.subjectId, status: "ACTIVE" },
    select: {
      student: {
        select: {
          id: true,
          universityId: true,
          serial: true,
          academicYear: true,
          user: { select: { fullName: true, email: true } },
          department: { select: { name: true } },
          specialization: { select: { name: true } },
        },
      },
    },
  });

  const rows: SheetRow[] = enrollments.map((enrollment) => {
    const student = enrollment.student;
    const overall = summarizeAttendanceCounts(perStudent.get(student.id) ?? []);
    const current = currentByStudent.get(student.id);

    return {
      studentId: student.id,
      serial: student.serial,
      fullName: student.user.fullName,
      universityId: student.universityId,
      academicYear: student.academicYear,
      departmentName: student.department.name,
      specializationName: student.specialization?.name ?? null,
      status: current?.status ?? null,
      reason: current?.reason ?? null,
      overall,
      isLow: overall.percentage !== null && overall.percentage < session.subject.attendanceLimit,
    };
  });

  return {
    id: session.id,
    date: session.date,
    title: session.title,
    notes: session.notes,
    subjectId: session.subject.id,
    subjectName: session.subject.name,
    subjectCode: session.subject.code,
    attendanceLimit: session.subject.attendanceLimit,
    professorName:
      session.subject.professors[0]?.professor.user.fullName ?? session.createdBy.user.fullName,
    createdAt: session.createdAt,
    rows,
    markedCount: session.records.length,
    summary: summarizeAttendanceCounts(
      session.records.map((record) => ({ status: record.status, count: 1 })),
    ),
    sessionsCount: session.subject._count.attendance,
  };
}

export type SaveRecordsResult = { saved: number; total: number };

export async function saveAttendanceRecords(
  input: SaveRecordsInput,
  actorId: string,
): Promise<SaveRecordsResult> {
  const session = await prisma.attendanceSession.findUnique({
    where: { id: input.sessionId },
    select: { id: true, subjectId: true, subject: { select: { name: true } } },
  });

  if (!session) throw new Error("المحاضرة غير موجودة.");

  const enrollments = await prisma.enrollment.findMany({
    where: { subjectId: session.subjectId, status: "ACTIVE" },
    select: { studentId: true },
  });

  const allowed = new Set(enrollments.map((enrollment) => enrollment.studentId));
  const entries = input.entries.filter((entry) => allowed.has(entry.studentId));

  if (entries.length === 0) throw new Error("لا توجد سجلات حضور صالحة للحفظ.");

  await prisma.$transaction(async (tx) => {
    for (const entry of entries) {
      await tx.attendanceRecord.upsert({
        where: { sessionId_studentId: { sessionId: input.sessionId, studentId: entry.studentId } },
        update: {
          status: entry.status,
          reason: entry.status === "PRESENT" ? null : entry.reason?.trim() || null,
        },
        create: {
          sessionId: input.sessionId,
          studentId: entry.studentId,
          status: entry.status,
          reason: entry.status === "PRESENT" ? null : entry.reason?.trim() || null,
        },
      });
    }

    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "attendance.update",
        entity: "AttendanceSession",
        entityId: input.sessionId,
        metadata: { subject: session.subject.name, count: entries.length },
      },
    });
  });

  return { saved: entries.length, total: allowed.size };
}

export async function getAttendanceTrend(
  sessionId: string,
  take = 10,
  scope?: AttendanceScope,
) {
  const session = await prisma.attendanceSession.findFirst({
    where: {
      id: sessionId,
      ...(scope?.subjectIds ? { subjectId: { in: scope.subjectIds } } : {}),
    },
    select: { subjectId: true },
  });

  if (!session) return [];

  const sessions = await prisma.attendanceSession.findMany({
    where: { subjectId: session.subjectId },
    orderBy: { date: "desc" },
    take,
    select: {
      id: true,
      date: true,
      title: true,
      records: { select: { status: true } },
    },
  });

  return sessions
    .map((session) => ({
      id: session.id,
      date: session.date,
      title: session.title,
      summary: summarizeAttendanceCounts(
        session.records.map((record) => ({ status: record.status, count: 1 })),
      ),
    }))
    .reverse();
}
