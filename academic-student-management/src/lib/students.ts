import { AttendanceStatus, Prisma, UserRole } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { z } from "zod";

import { percentOf } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import {
  resolveStudentSort,
  sortStudents,
  type StudentSortField,
} from "@/lib/student-sort";
import {
  summarizeAttendance,
  summarizeAttendanceCounts,
  type AttendanceSummary,
} from "@/lib/dashboard-data";

/**
 * The whole filtered list used to be rendered in one scrolling table. That is what
 * froze the browser: a couple of thousand rows, each with a dozen cells, is tens of
 * thousands of DOM nodes to hydrate and paint on every navigation.
 *
 * The scan limit below now only bounds the per-row aggregates (attendance group-by
 * and graded attempts). What reaches the page is one page of rows, and crossing the
 * limit shows a warning instead of silently hiding rows.
 */
export const MAX_STUDENT_SCAN = 2000;

/** Rows rendered per page. Bounded so a full page stays cheap to hydrate and scroll. */
export const STUDENT_PAGE_SIZE = 100;

export const STUDENT_PAGE_SIZES = [50, 100, 200] as const;
const BCRYPT_ROUNDS = 10;

export const studentFormSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(4, "الاسم الكامل مطلوب (4 أحرف على الأقل).")
    .max(120, "الاسم طويل جداً."),
  email: z.string().trim().toLowerCase().email("صيغة البريد الإلكتروني غير صحيحة."),
  phone: z
    .string()
    .trim()
    .regex(/^[0-9+\-\s]{6,20}$/, "رقم الهاتف غير صالح.")
    .optional()
    .or(z.literal("")),
  universityId: z
    .string()
    .trim()
    .min(1, "الرقم المرجعي مطلوب.")
    .max(30, "الرقم المرجعي طويل جداً."),
  serial: z
    .string()
    .trim()
    .max(30, "رقم المسلسل طويل جداً.")
    .optional()
    .or(z.literal("")),
  departmentId: z.string().min(1, "القسم مطلوب."),
  specializationId: z
    .string()
    .trim()
    .optional()
    .or(z.literal(""))
    .refine((value) => !value || value.length >= 10, "معرف التخصص غير صحيح."),
  academicYear: z.coerce
    .number({ invalid_type_error: "الفرقة الدراسية غير صحيحة." })
    .int("الفرقة الدراسية غير صحيحة.")
    .min(1, "الفرقة الدراسية غير صحيحة.")
    .max(10, "الفرقة الدراسية غير صحيحة."),
  password: z.string().min(8, "كلمة المرور 8 أحرف على الأقل.").optional().or(z.literal("")),
});

export type StudentFormValues = z.infer<typeof studentFormSchema>;
export type StudentInput = StudentFormValues;

export type AttendanceState = "all" | "low" | "mid" | "high";

export type StudentFilters = {
  query?: string;
  departmentId?: string;
  academicYear?: string;
  attendanceState?: AttendanceState;
  sortBy?: string;
  sortDir?: "asc" | "desc";
  /** 1-based page number. Absent means the first page. */
  page?: number;
  pageSize?: number;
};

export type StudentListItem = {
  id: string;
  serial: string | null;
  fullName: string;
  email: string;
  phone: string | null;
  universityId: string;
  academicYear: number;
  departmentId: string;
  departmentName: string;
  specializationId: string | null;
  specializationName: string | null;
  isActive: boolean;
  subjectsCount: number;
  attendance: AttendanceSummary;
  averageScore: number | null;
};

export type StudentListResult = {
  /** The current page only: this is what the table renders. */
  rows: StudentListItem[];
  /** Every matching row, so the CSV export stays complete regardless of the page. */
  exportRows: StudentListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  totalStudents: number;
  totalSubjects: number;
  lowAttendanceCount: number;
  averageAttendance: number | null;
  averageScore: number | null;
  isTruncated: boolean;
};

export type StudentSearchParams = Record<string, string | string[] | undefined>;

function readParam(params: StudentSearchParams, key: string) {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

function readNumber(value: string | undefined) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseStudentFilters(params: StudentSearchParams): StudentFilters {
  const attendanceState = readParam(params, "attendanceState");
  const sortBy = readParam(params, "sortBy")?.trim();
  const sortDir = readParam(params, "sortDir");
  const pageSizeRaw = readNumber(readParam(params, "pageSize"));
  const pageRaw = readNumber(readParam(params, "page"));

  return {
    query: readParam(params, "query")?.trim() || undefined,
    departmentId: readParam(params, "departmentId") || undefined,
    academicYear: readParam(params, "academicYear") || undefined,
    attendanceState:
      attendanceState === "low" || attendanceState === "mid" || attendanceState === "high"
        ? attendanceState
        : "all",
    sortBy: sortBy || undefined,
    sortDir: sortDir === "desc" ? "desc" : sortDir === "asc" ? "asc" : undefined,
    page: pageRaw && pageRaw > 0 ? Math.floor(pageRaw) : undefined,
    pageSize:
      pageSizeRaw && (STUDENT_PAGE_SIZES as readonly number[]).includes(pageSizeRaw)
        ? pageSizeRaw
        : undefined,
  };
}

/** Clamps a requested page into the range that actually holds rows. */
export function resolveStudentPage(page: number | undefined, pageSize: number | undefined, total: number) {
  const size = pageSize && (STUDENT_PAGE_SIZES as readonly number[]).includes(pageSize)
    ? pageSize
    : STUDENT_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(1, Math.floor(page ?? 1)), totalPages);
  return { size, totalPages, current };
}

function buildWhere(filters: StudentFilters): Prisma.StudentWhereInput {
  const query = filters.query?.trim();
  const academicYear = readNumber(filters.academicYear);

  return {
    ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
    ...(academicYear ? { academicYear } : {}),
    ...(query
      ? {
          OR: [
            { user: { fullName: { contains: query, mode: "insensitive" as const } } },
            { universityId: { contains: query, mode: "insensitive" as const } },
            { serial: { contains: query, mode: "insensitive" as const } },
            { user: { email: { contains: query, mode: "insensitive" as const } } },
            { phone: { contains: query, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };
}

function averageOf(values: (number | null)[]) {
  const numbers = values.filter((value): value is number => value !== null);
  return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : null;
}

function matchesAttendanceState(percentage: number | null, state: AttendanceState) {
  if (state === "all") return true;
  if (percentage === null) return false;
  if (state === "low") return percentage < 75;
  if (state === "mid") return percentage >= 75 && percentage < 85;
  return percentage >= 85;
}

export async function listStudents(filters: StudentFilters): Promise<StudentListResult> {
  const where = buildWhere(filters);

  const [students, totalStudents, totalSubjects] = await Promise.all([
    prisma.student.findMany({
      where,
      // The sorted output is produced in memory below, so this only has to make
      // the scan itself predictable and stable.
      orderBy: { user: { fullName: "asc" } },
      take: MAX_STUDENT_SCAN,
      select: {
        id: true,
        serial: true,
        universityId: true,
        phone: true,
        academicYear: true,
        user: { select: { fullName: true, email: true, isActive: true } },
        department: { select: { id: true, name: true } },
        specialization: { select: { id: true, name: true } },
        _count: { select: { enrollments: true } },
      },
    }),
    prisma.student.count(),
    prisma.subject.count(),
  ]);

  const studentIds = students.map((student) => student.id);

  const [attendanceRows, gradedAttempts] = await Promise.all([
    studentIds.length
      ? prisma.attendanceRecord.groupBy({
          by: ["studentId", "status"],
          where: { studentId: { in: studentIds } },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    studentIds.length
      ? prisma.examAttempt.findMany({
          where: { studentId: { in: studentIds }, status: "GRADED", score: { not: null } },
          select: { studentId: true, score: true, exam: { select: { totalScore: true } } },
        })
      : Promise.resolve([]),
  ]);

  const countRowsByStudent = new Map<string, { status: AttendanceStatus; count: number }[]>();
  for (const row of attendanceRows) {
    const list = countRowsByStudent.get(row.studentId) ?? [];
    list.push({ status: row.status, count: row._count._all });
    countRowsByStudent.set(row.studentId, list);
  }

  const scoresByStudent = new Map<string, { earned: number; total: number }>();
  for (const attempt of gradedAttempts) {
    const current = scoresByStudent.get(attempt.studentId) ?? { earned: 0, total: 0 };
    current.earned += attempt.score ?? 0;
    current.total += attempt.exam.totalScore;
    scoresByStudent.set(attempt.studentId, current);
  }

  const allRows: StudentListItem[] = students.map((student) => {
    const scores = scoresByStudent.get(student.id);

    return {
      id: student.id,
      serial: student.serial,
      fullName: student.user.fullName,
      email: student.user.email,
      phone: student.phone,
      universityId: student.universityId,
      academicYear: student.academicYear,
      departmentId: student.department.id,
      departmentName: student.department.name,
      specializationId: student.specialization?.id ?? null,
      specializationName: student.specialization?.name ?? null,
      isActive: student.user.isActive,
      subjectsCount: student._count.enrollments,
      attendance: summarizeAttendanceCounts(countRowsByStudent.get(student.id) ?? []),
      averageScore: scores ? percentOf(scores.earned, scores.total) : null,
    };
  });

  const state = filters.attendanceState ?? "all";
  const filteredRows = allRows.filter((row) =>
    matchesAttendanceState(row.attendance.percentage, state),
  );

  const sort = resolveStudentSort(filters.sortBy, filters.sortDir);
  const sortedRows = sortStudents(filteredRows, sort);

  const total = sortedRows.length;
  const paging = resolveStudentPage(filters.page, filters.pageSize, total);
  const start = (paging.current - 1) * paging.size;

  return {
    rows: sortedRows.slice(start, start + paging.size),
    exportRows: sortedRows,
    total,
    page: paging.current,
    pageSize: paging.size,
    totalPages: paging.totalPages,
    totalStudents,
    totalSubjects,
    lowAttendanceCount: allRows.filter((row) => (row.attendance.percentage ?? 100) < 75).length,
    averageAttendance: averageOf(allRows.map((row) => row.attendance.percentage)),
    averageScore: averageOf(allRows.map((row) => row.averageScore)),
    isTruncated: allRows.length === MAX_STUDENT_SCAN,
  };
}

export async function getDepartments() {
  return prisma.department.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, code: true },
  });
}

/**
 * The reference number is shared between students, so only the email has to be
 * unique here.
 */
async function assertUniqueEmail(email: string, excludeStudentId?: string) {
  if (!email) return;

  const clash = await prisma.student.findFirst({
    where: {
      user: { email },
      ...(excludeStudentId ? { id: { not: excludeStudentId } } : {}),
    },
    select: { id: true },
  });

  if (clash) throw new Error("البريد الإلكتروني مستخدم بالفعل لطالب آخر.");
}

/** A specialization is optional, but when given it must belong to the chosen department. */
async function resolveSpecializationId(
  departmentId: string,
  specializationId: string | null | undefined,
) {
  const value = specializationId?.trim();
  if (!value) return null;

  const specialization = await prisma.specialization.findFirst({
    where: { id: value, departmentId },
    select: { id: true },
  });

  if (!specialization) throw new Error("التخصص المحدد لا ينتمي إلى القسم المختار.");
  return specialization.id;
}

export async function createStudent(input: StudentInput, actorId: string) {
  const email = input.email.trim().toLowerCase();
  const password = input.password?.trim() ?? "";

  if (password.length < 8) {
    throw new Error("كلمة المرور مطلوبة عند إنشاء طالب جديد (8 أحرف على الأقل).");
  }

  await assertUniqueEmail(email);
  const specializationId = await resolveSpecializationId(
    input.departmentId,
    input.specializationId,
  );

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  return prisma.$transaction(async (tx) => {
    const created = await tx.student.create({
      data: {
        universityId: input.universityId.trim(),
        serial: input.serial?.trim() ? input.serial.trim() : null,
        phone: input.phone?.trim() ? input.phone.trim() : null,
        academicYear: input.academicYear,
        department: { connect: { id: input.departmentId } },
        specialization: specializationId ? { connect: { id: specializationId } } : undefined,
        user: {
          create: {
            email,
            fullName: input.fullName.trim(),
            passwordHash,
            role: UserRole.STUDENT,
          },
        },
      },
      select: { id: true, universityId: true, user: { select: { fullName: true, email: true } } },
    });

    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "student.create",
        entity: "Student",
        entityId: created.id,
        metadata: {
          fullName: created.user.fullName,
          email: created.user.email,
          universityId: created.universityId,
        },
      },
    });

    return created;
  });
}

export async function updateStudent(studentId: string, input: StudentInput, actorId: string) {
  const email = input.email.trim().toLowerCase();
  const password = input.password?.trim() ?? "";

  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { id: true, userId: true },
  });

  if (!student) throw new Error("الطالب غير موجود.");

  await assertUniqueEmail(email, studentId);
  const specializationId = await resolveSpecializationId(
    input.departmentId,
    input.specializationId,
  );

  const passwordHash = password ? await bcrypt.hash(password, BCRYPT_ROUNDS) : null;

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: student.userId },
      data: {
        fullName: input.fullName.trim(),
        email,
        ...(passwordHash ? { passwordHash } : {}),
      },
    });

    await tx.student.update({
      where: { id: studentId },
      data: {
        universityId: input.universityId.trim(),
        serial: input.serial?.trim() ? input.serial.trim() : null,
        phone: input.phone?.trim() ? input.phone.trim() : null,
        academicYear: input.academicYear,
        departmentId: input.departmentId,
        specializationId,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "student.update",
        entity: "Student",
        entityId: studentId,
        metadata: {
          fullName: input.fullName.trim(),
          email,
          passwordChanged: Boolean(passwordHash),
        },
      },
    });
  });
}

export async function setStudentActive(studentId: string, isActive: boolean, actorId: string) {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { id: true, userId: true },
  });

  if (!student) throw new Error("الطالب غير موجود.");

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: student.userId }, data: { isActive } });
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "student.update",
        entity: "Student",
        entityId: studentId,
        metadata: { isActive },
      },
    });
  });
}

export async function deleteStudent(studentId: string, actorId: string) {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { id: true, userId: true, universityId: true, user: { select: { fullName: true } } },
  });

  if (!student) throw new Error("الطالب غير موجود.");

  await prisma.$transaction(async (tx) => {
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "student.delete",
        entity: "Student",
        entityId: studentId,
        metadata: { fullName: student.user.fullName, universityId: student.universityId },
      },
    });

    await tx.user.delete({ where: { id: student.userId } });
  });
}

export type BulkDeleteResult = { deleted: number; skipped: number };

/**
 * Deletes the given students together with their user accounts, attendance and
 * grades. One audit entry per student is written so the trail matches the
 * single-student delete. Ids that no longer exist are reported as skipped
 * instead of failing the whole batch.
 */
export async function deleteStudents(studentIds: string[], actorId: string): Promise<BulkDeleteResult> {
  const uniqueIds = [...new Set(studentIds.map((id) => id.trim()).filter(Boolean))];
  if (uniqueIds.length === 0) return { deleted: 0, skipped: 0 };

  const students = await prisma.student.findMany({
    where: { id: { in: uniqueIds } },
    select: { id: true, userId: true, universityId: true, user: { select: { fullName: true } } },
  });

  if (students.length === 0) return { deleted: 0, skipped: uniqueIds.length };

  await prisma.$transaction(async (tx) => {
    await tx.auditLog.createMany({
      data: students.map((student) => ({
        userId: actorId,
        action: "student.delete",
        entity: "Student",
        entityId: student.id,
        metadata: {
          fullName: student.user.fullName,
          universityId: student.universityId,
          source: "bulk",
        },
      })),
    });

    await tx.user.deleteMany({ where: { id: { in: students.map((student) => student.userId) } } });
  });

  return { deleted: students.length, skipped: uniqueIds.length - students.length };
}

/**
 * Resolves the ids the current table filters resolve to. It reuses the exact
 * query behind the table, so a bulk action can never reach students the admin
 * could not already list, and it inherits the 500-row scan cap.
 */
export async function studentIdsMatchingFilters(filters: StudentFilters): Promise<string[]> {
  const { exportRows } = await listStudents(filters);
  return exportRows.map((row) => row.id);
}

/**
 * Deletes every student the current filters resolve to. It reuses the same query
 * as the table, so the rows that get deleted are exactly the ones on screen.
 */
export async function deleteStudentsMatchingFilters(
  filters: StudentFilters,
  actorId: string,
): Promise<BulkDeleteResult> {
  return deleteStudents(await studentIdsMatchingFilters(filters), actorId);
}

export type StudentEditData = {
  id: string;
  serial: string | null;
  fullName: string;
  email: string;
  phone: string | null;
  universityId: string;
  academicYear: number;
  departmentId: string;
  specializationId: string | null;
  isActive: boolean;
};

export async function getStudentForEdit(studentId: string): Promise<StudentEditData | null> {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: {
      id: true,
      serial: true,
      universityId: true,
      phone: true,
      academicYear: true,
      departmentId: true,
      specializationId: true,
      user: { select: { fullName: true, email: true, isActive: true } },
    },
  });

  if (!student) return null;

  return {
    id: student.id,
    serial: student.serial,
    fullName: student.user.fullName,
    email: student.user.email,
    phone: student.phone,
    universityId: student.universityId,
    academicYear: student.academicYear,
    departmentId: student.departmentId,
    specializationId: student.specializationId,
    isActive: student.user.isActive,
  };
}

export type StudentProfile = NonNullable<Awaited<ReturnType<typeof getStudentProfile>>>;

export async function getStudentProfile(studentId: string) {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: {
      id: true,
      serial: true,
      universityId: true,
      phone: true,
      academicYear: true,
      createdAt: true,
      user: { select: { fullName: true, email: true, isActive: true, lastLoginAt: true } },
      department: { select: { id: true, name: true, code: true } },
      specialization: { select: { id: true, name: true, code: true } },
      enrollments: {
        where: { status: "ACTIVE" },
        select: {
          id: true,
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
              attendance: {
                select: { records: { where: { studentId }, select: { status: true } } },
              },
            },
          },
        },
      },
      examAttempts: {
        orderBy: { submittedAt: "desc" },
        select: {
          id: true,
          score: true,
          status: true,
          submittedAt: true,
          exam: { select: { title: true, totalScore: true, subject: { select: { name: true } } } },
        },
        take: 30,
      },
    },
  });

  if (!student) return null;

  const subjects = student.enrollments.map((enrollment) => ({
    id: enrollment.subject.id,
    name: enrollment.subject.name,
    code: enrollment.subject.code,
    professorName: enrollment.subject.professors[0]?.professor.user.fullName ?? null,
    attendanceLimit: enrollment.subject.attendanceLimit,
    attendance: summarizeAttendance(
      enrollment.subject.attendance.flatMap((session) =>
        session.records.map((record) => record.status),
      ),
    ),
  }));

  const graded = student.examAttempts.filter((attempt) => attempt.status === "GRADED");
  const totalScore = graded.reduce((sum, attempt) => sum + attempt.exam.totalScore, 0);
  const earnedScore = graded.reduce((sum, attempt) => sum + (attempt.score ?? 0), 0);

  return {
    id: student.id,
    serial: student.serial,
    fullName: student.user.fullName,
    email: student.user.email,
    isActive: student.user.isActive,
    lastLoginAt: student.user.lastLoginAt,
    phone: student.phone,
    universityId: student.universityId,
    academicYear: student.academicYear,
    departmentId: student.department.id,
    departmentName: student.department.name,
    departmentCode: student.department.code,
    specializationId: student.specialization?.id ?? null,
    specializationName: student.specialization?.name ?? null,
    specializationCode: student.specialization?.code ?? null,
    createdAt: student.createdAt,
    subjects,
    averageAttendance: averageOf(subjects.map((subject) => subject.attendance.percentage)),
    averageScore: percentOf(earnedScore, totalScore),
    attempts: student.examAttempts.map((attempt) => ({
      id: attempt.id,
      examTitle: attempt.exam.title,
      subjectName: attempt.exam.subject.name,
      status: attempt.status,
      score: attempt.score,
      totalScore: attempt.exam.totalScore,
      percentage: percentOf(attempt.score ?? 0, attempt.exam.totalScore),
      submittedAt: attempt.submittedAt,
    })),
  };
}
