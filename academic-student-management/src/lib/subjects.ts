import { AttendanceStatus, Prisma, QuestionType } from "@prisma/client";
import { z } from "zod";

import { summarizeAttendanceCounts, type AttendanceSummary } from "@/lib/dashboard-data";
import { percentOf } from "@/lib/format";
import { prisma } from "@/lib/prisma";

export const subjectFormSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2, "كود المادة مطلوب.")
    .max(20, "كود المادة طويل جداً.")
    .regex(/^[A-Za-z0-9\-_]+$/, "كود المادة يقبل حروفاً إنجليزية وأرقاماً فقط."),
  name: z.string().trim().min(3, "اسم المادة مطلوب (3 أحرف على الأقل).").max(120),
  description: z.string().trim().max(500).optional().or(z.literal("")),
  creditHours: z.coerce
    .number({ invalid_type_error: "عدد الساعات غير صحيح." })
    .int("عدد الساعات غير صحيح.")
    .min(1, "عدد الساعات غير صحيح.")
    .max(12, "عدد الساعات غير صحيح."),
  attendanceLimit: z.coerce
    .number({ invalid_type_error: "نسبة الحضور غير صحيحة." })
    .min(0, "نسبة الحضور غير صحيحة.")
    .max(100, "نسبة الحضور غير صحيحة."),
  departmentId: z.string().min(1, "القسم مطلوب."),
  academicTermId: z.string().min(1, "الفصل الدراسي مطلوب."),
  professorId: z.string().min(1, "عضو هيئة التدريس مطلوب."),
});

export type SubjectFormValues = z.infer<typeof subjectFormSchema>;

export type SubjectFilters = {
  query?: string;
  departmentId?: string;
  academicTermId?: string;
  page?: number;
  pageSize?: number;
};

export type SubjectSearchParams = Record<string, string | string[] | undefined>;

export type SubjectListItem = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  creditHours: number;
  attendanceLimit: number;
  departmentId: string;
  departmentName: string;
  academicTermId: string;
  academicTermName: string;
  professorId: string | null;
  professorName: string | null;
  studentsCount: number;
  attendance: AttendanceSummary;
  lowAttendanceCount: number;
  examsCount: number;
  questionsCount: number;
};

export type SubjectListResult = {
  rows: SubjectListItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  totalSubjects: number;
  totalStudents: number;
  averageAttendance: number | null;
  averageCreditHours: number | null;
};

const LOW_ATTENDANCE_LIMIT = 75;

function readParam(params: SubjectSearchParams, key: string) {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

function readNumber(value: string | undefined) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseSubjectFilters(params: SubjectSearchParams): SubjectFilters {
  return {
    query: readParam(params, "query")?.trim() || undefined,
    departmentId: readParam(params, "departmentId") || undefined,
    academicTermId: readParam(params, "academicTermId") || undefined,
    page: readNumber(readParam(params, "page")) ?? 1,
    pageSize: readNumber(readParam(params, "pageSize")) ?? 10,
  };
}

function buildWhere(filters: SubjectFilters): Prisma.SubjectWhereInput {
  const query = filters.query?.trim();

  return {
    ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
    ...(filters.academicTermId ? { academicTermId: filters.academicTermId } : {}),
    ...(query
      ? {
          OR: [
            { name: { contains: query, mode: "insensitive" as const } },
            { code: { contains: query, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };
}

function averageOf(values: (number | null)[]) {
  const numbers = values.filter((value): value is number => value !== null);
  return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : null;
}

export async function listSubjects(filters: SubjectFilters): Promise<SubjectListResult> {
  const pageSize = Math.min(50, Math.max(5, filters.pageSize ?? 10));
  const page = Math.max(1, filters.page ?? 1);
  const where = buildWhere(filters);

  const [total, totalSubjects, totalStudents, subjects] = await Promise.all([
    prisma.subject.count({ where }),
    prisma.subject.count(),
    prisma.student.count(),
    prisma.subject.findMany({
      where,
      orderBy: { code: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        code: true,
        name: true,
        description: true,
        creditHours: true,
        attendanceLimit: true,
        department: { select: { id: true, name: true } },
        academicTerm: { select: { id: true, name: true } },
        professors: {
          where: { isPrimary: true },
          take: 1,
          select: { professor: { select: { id: true, user: { select: { fullName: true } } } } },
        },
        enrollments: {
          where: { status: "ACTIVE" },
          select: {
            id: true,
            student: { select: { id: true, universityId: true, user: { select: { fullName: true } } } },
          },
        },
        exams: { select: { id: true } },
        questions: { select: { id: true } },
        attendance: { select: { records: { select: { studentId: true, status: true } } } },
      },
    }),
  ]);

  const rows: SubjectListItem[] = subjects.map((subject) => {
    const records = subject.attendance.flatMap((session) => session.records);

    const perStudent = new Map<string, { status: AttendanceStatus; count: number }[]>();
    for (const record of records) {
      const list = perStudent.get(record.studentId) ?? [];
      const existing = list.find((row) => row.status === record.status);
      if (existing) existing.count += 1;
      else list.push({ status: record.status, count: 1 });
      perStudent.set(record.studentId, list);
    }

    const perStudentSummary = [...perStudent.entries()].map(([studentId, counts]) => ({
      studentId,
      summary: summarizeAttendanceCounts(counts),
    }));

    const primaryProfessor = subject.professors[0]?.professor;

    return {
      id: subject.id,
      code: subject.code,
      name: subject.name,
      description: subject.description,
      creditHours: subject.creditHours,
      attendanceLimit: subject.attendanceLimit,
      departmentId: subject.department.id,
      departmentName: subject.department.name,
      academicTermId: subject.academicTerm.id,
      academicTermName: subject.academicTerm.name,
      professorId: primaryProfessor?.id ?? null,
      professorName: primaryProfessor?.user.fullName ?? null,
      studentsCount: subject.enrollments.length,
      attendance: summarizeAttendanceCounts(
        records.map((record) => ({ status: record.status, count: 1 })),
      ),
      lowAttendanceCount: perStudentSummary.filter(
        (entry) => (entry.summary.percentage ?? 100) < subject.attendanceLimit,
      ).length,
examsCount: subject.exams.length,
      questionsCount: subject.questions.length,
    };
  });

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pageCount);

  return {
    rows,
    total,
    page: safePage,
    pageSize,
    pageCount,
    totalSubjects,
    totalStudents,
    averageAttendance: averageOf(rows.map((row) => row.attendance.percentage)),
    averageCreditHours: averageOf(rows.map((row) => row.creditHours)),
  };
}

export async function getDepartments() {
  return prisma.department.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, code: true },
  });
}

export async function getAcademicTerms() {
  return prisma.academicTerm.findMany({
    orderBy: { startDate: "desc" },
    select: { id: true, name: true, isCurrent: true },
  });
}

export async function getProfessors() {
  const professors = await prisma.professor.findMany({
    orderBy: { user: { fullName: "asc" } },
    select: {
      id: true,
      employeeCode: true,
      departmentId: true,
      user: { select: { fullName: true, email: true, isActive: true } },
    },
  });

  return professors;
}

async function assertUniqueCode(code: string, excludeSubjectId?: string) {
  const clash = await prisma.subject.findFirst({
    where: { code, ...(excludeSubjectId ? { id: { not: excludeSubjectId } } : {}) },
    select: { id: true },
  });

  if (clash) throw new Error("كود المادة مستخدم بالفعل.");
}

/** Professors assigned to a subject must belong to that subject's department. */
async function assertProfessorInDepartment(professorId: string, departmentId: string) {
  const professor = await prisma.professor.findUnique({
    where: { id: professorId },
    select: { id: true, departmentId: true },
  });

  if (!professor) throw new Error("عضو هيئة التدريس غير موجود.");
  if (professor.departmentId !== departmentId) {
    throw new Error("عضو هيئة التدريس المختار يجب أن يكون من نفس قسم المادة.");
  }
}

export async function createSubject(input: SubjectFormValues, actorId: string) {
  const code = input.code.trim().toUpperCase();
  await assertUniqueCode(code);
  await assertProfessorInDepartment(input.professorId, input.departmentId);

  const subject = await prisma.$transaction(async (tx) => {
    const created = await tx.subject.create({
      data: {
        code,
        name: input.name.trim(),
        description: input.description?.trim() ? input.description.trim() : null,
        creditHours: input.creditHours,
        attendanceLimit: input.attendanceLimit,
        department: { connect: { id: input.departmentId } },
        academicTerm: { connect: { id: input.academicTermId } },
        professors: { create: { professorId: input.professorId, isPrimary: true } },
      },
      select: { id: true, code: true, name: true },
    });

    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "subject.create",
        entity: "Subject",
        entityId: created.id,
        metadata: { code: created.code, name: created.name },
      },
    });

    return created;
  });

  return subject;
}

export async function updateSubject(subjectId: string, input: SubjectFormValues, actorId: string) {
  const code = input.code.trim().toUpperCase();
  await assertUniqueCode(code, subjectId);

  const before = await prisma.subject.findFirst({
    where: { id: subjectId },
    select: {
      departmentId: true,
      professors: { where: { isPrimary: true }, take: 1, select: { professorId: true } },
    },
  });

  if (!before) throw new Error("المادة غير موجودة.");

  const currentPrimary = before.professors[0]?.professorId;
  const departmentChanged = before.departmentId !== input.departmentId;
  const professorUnchanged = currentPrimary === input.professorId;
  if (!(professorUnchanged && !departmentChanged)) {
    await assertProfessorInDepartment(input.professorId, input.departmentId);
  }

  await prisma.$transaction(async (tx) => {
    await tx.subject.update({
      where: { id: subjectId },
      data: {
        code,
        name: input.name.trim(),
        description: input.description?.trim() ? input.description.trim() : null,
        creditHours: input.creditHours,
        attendanceLimit: input.attendanceLimit,
        department: { connect: { id: input.departmentId } },
        academicTerm: { connect: { id: input.academicTermId } },
      },
    });

    await tx.subjectProfessor.upsert({
      where: { subjectId_professorId: { subjectId, professorId: input.professorId } },
      update: { isPrimary: true },
      create: { subjectId, professorId: input.professorId, isPrimary: true },
    });

    await tx.subjectProfessor.updateMany({
      where: { subjectId, professorId: { not: input.professorId } },
      data: { isPrimary: false },
    });

    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "subject.update",
        entity: "Subject",
        entityId: subjectId,
        metadata: { code, name: input.name.trim() },
      },
    });
  });
}

export async function deleteSubject(subjectId: string, actorId: string) {
  const subject = await prisma.subject.findUnique({
    where: { id: subjectId },
    select: { id: true, code: true, name: true },
  });

  if (!subject) throw new Error("المادة غير موجودة.");

  await prisma.$transaction(async (tx) => {
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "subject.delete",
        entity: "Subject",
        entityId: subjectId,
        metadata: { code: subject.code, name: subject.name },
      },
    });

    await tx.subject.delete({ where: { id: subjectId } });
  });
}

export type SubjectPickerOption = {
  id: string;
  code: string;
  name: string;
  departmentName: string;
  academicTermName: string;
  studentsCount: number;
};

/**
 * Flat subject list for the bulk-enrolment picker. Deliberately free of the
 * per-subject aggregates `listSubjects` computes, so every subject can be handed
 * to the client at once and filtered there.
 */
export async function getSubjectPickerOptions(): Promise<SubjectPickerOption[]> {
  const subjects = await prisma.subject.findMany({
    orderBy: { code: "asc" },
    select: {
      id: true,
      code: true,
      name: true,
      department: { select: { name: true } },
      academicTerm: { select: { name: true } },
      _count: { select: { enrollments: true } },
    },
  });

  return subjects.map((subject) => ({
    id: subject.id,
    code: subject.code,
    name: subject.name,
    departmentName: subject.department.name,
    academicTermName: subject.academicTerm.name,
    studentsCount: subject._count.enrollments,
  }));
}

export type EnrollResult = { added: number; skipped: number };

export async function enrollStudents(subjectId: string, studentIds: string[], actorId: string) {
  if (studentIds.length === 0) throw new Error("اختر طالباً واحداً على الأقل للتسجيل.");

  const subject = await prisma.subject.findUnique({
    where: { id: subjectId },
    select: { id: true, name: true, code: true },
  });

  if (!subject) throw new Error("المادة غير موجودة.");

  const result = await prisma.enrollment.createMany({
    data: studentIds.map((studentId) => ({ studentId, subjectId, status: "ACTIVE" })),
    skipDuplicates: true,
  });

  await prisma.auditLog.create({
    data: {
      userId: actorId,
      action: "subject.update",
      entity: "Subject",
      entityId: subjectId,
      metadata: { enrollment: "add", count: result.count, code: subject.code },
    },
  });

  return { added: result.count, skipped: studentIds.length - result.count };
}

export type BulkEnrollTarget = {
  studentIds: string[];
  /** Explicit subjects. Ignored when `allSubjects` is set. */
  subjectIds: string[];
  allSubjects: boolean;
  actorId: string;
};

export type BulkEnrollResult = {
  students: number;
  subjects: number;
  enrollments: number;
  enrolled: number;
  reactivated: number;
  alreadyActive: number;
  unknownStudents: number;
  unknownSubjects: number;
};

/** Postgres caps a single statement at 65535 bind parameters, so writes are batched. */
const BULK_ENROLL_BATCH = 1000;

function chunked<T>(items: T[], size: number) {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) batches.push(items.slice(index, index + size));
  return batches;
}

/**
 * Registers every selected student into every selected subject.
 *
 * The `(studentId, subjectId)` pair is unique, so a pair that already exists is
 * never duplicated: it is either left alone or, when it is not ACTIVE, put back
 * to ACTIVE. Reactivating matches the Excel-import path and is what an admin
 * means by "add these students to that subject" — a withdrawn or completed row
 * would otherwise stay invisible on the attendance page.
 */
export async function enrollStudentsInSubjects({
  studentIds,
  subjectIds,
  allSubjects,
  actorId,
}: BulkEnrollTarget): Promise<BulkEnrollResult> {
  const requestedStudentIds = [...new Set(studentIds.map((id) => id.trim()).filter(Boolean))];
  const requestedSubjectIds = [...new Set(subjectIds.map((id) => id.trim()).filter(Boolean))];

  if (requestedStudentIds.length === 0) throw new Error("اختر طالباً واحداً على الأقل للتسجيل.");

  const [students, subjects] = await Promise.all([
    prisma.student.findMany({
      where: { id: { in: requestedStudentIds } },
      select: { id: true },
    }),
    allSubjects
      ? prisma.subject.findMany({ select: { id: true, code: true } })
      : prisma.subject.findMany({
          where: { id: { in: requestedSubjectIds } },
          select: { id: true, code: true },
        }),
  ]);

  if (subjects.length === 0) throw new Error("اختر مادة واحدة على الأقل للتسجيل.");

  const studentIdsInDb = students.map((student) => student.id);
  const subjectIdsInDb = subjects.map((subject) => subject.id);

  // Every selected student is registered into every selected subject, so the
  // cross product is exactly the target set. `updateMany` only touches rows that
  // already exist, which makes it safe to express the reactivation in one query.
  const pairs = studentIdsInDb.flatMap((studentId) => subjectIdsInDb.map((subjectId) => ({ studentId, subjectId })));

  let enrolled = 0;
  let reactivated = 0;

  await prisma.$transaction(async (tx) => {
    for (const batch of chunked(pairs, BULK_ENROLL_BATCH)) {
      const inserted = await tx.enrollment.createMany({
        data: batch,
        skipDuplicates: true,
      });
      enrolled += inserted.count;
    }

    for (const batch of chunked(studentIdsInDb, BULK_ENROLL_BATCH)) {
      const updated = await tx.enrollment.updateMany({
        where: {
          studentId: { in: batch },
          subjectId: { in: subjectIdsInDb },
          status: { not: "ACTIVE" },
        },
        data: { status: "ACTIVE" },
      });
      reactivated += updated.count;
    }

    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "subject.update",
        entity: "Subject",
        entityId: subjectIdsInDb.length === 1 ? subjectIdsInDb[0] : null,
        metadata: {
          enrollment: allSubjects ? "bulk-all-subjects" : "bulk-subjects",
          subjects: subjectIdsInDb.length,
          students: studentIdsInDb.length,
          enrolled,
          reactivated,
          allSubjects,
          codes: subjects.map((subject) => subject.code).slice(0, 50),
        },
      },
    });
  });

  return {
    students: studentIdsInDb.length,
    subjects: subjectIdsInDb.length,
    enrollments: pairs.length,
    enrolled,
    reactivated,
    alreadyActive: pairs.length - enrolled - reactivated,
    unknownStudents: requestedStudentIds.length - studentIdsInDb.length,
    unknownSubjects: allSubjects ? 0 : requestedSubjectIds.length - subjectIdsInDb.length,
  };
}

export async function unenrollStudent(subjectId: string, studentId: string, actorId: string) {
  const enrollment = await prisma.enrollment.findUnique({
    where: { studentId_subjectId: { studentId, subjectId } },
    select: { id: true },
  });

  if (!enrollment) throw new Error("الطالب غير مسجل في هذه المادة.");

  await prisma.$transaction(async (tx) => {
    await tx.attendanceRecord.deleteMany({
      where: { studentId, session: { subjectId } },
    });

    await tx.enrollment.delete({ where: { id: enrollment.id } });

    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "subject.update",
        entity: "Subject",
        entityId: subjectId,
        metadata: { enrollment: "remove", studentId },
      },
    });
  });
}

export type SubjectEditData = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  creditHours: number;
  attendanceLimit: number;
  departmentId: string;
  academicTermId: string;
  professorId: string | null;
};

export async function getSubjectForEdit(subjectId: string): Promise<SubjectEditData | null> {
  const subject = await prisma.subject.findUnique({
    where: { id: subjectId },
    select: {
      id: true,
      code: true,
      name: true,
      description: true,
      creditHours: true,
      attendanceLimit: true,
      departmentId: true,
      academicTermId: true,
      professors: {
        where: { isPrimary: true },
        take: 1,
        select: { professorId: true },
      },
    },
  });

  if (!subject) return null;

  return {
    id: subject.id,
    code: subject.code,
    name: subject.name,
    description: subject.description,
    creditHours: subject.creditHours,
    attendanceLimit: subject.attendanceLimit,
    departmentId: subject.departmentId,
    academicTermId: subject.academicTermId,
    professorId: subject.professors[0]?.professorId ?? null,
  };
}

export type EnrolledStudent = {
  enrollmentId: string;
  studentId: string;
  fullName: string;
  email: string;
  universityId: string;
  academicYear: number;
  departmentName: string;
  enrolledAt: Date;
  attendance: AttendanceSummary;
  averageScore: number | null;
};

export type SubjectDetail = NonNullable<Awaited<ReturnType<typeof getSubjectDetail>>>;

export async function getSubjectDetail(subjectId: string) {
  const subject = await prisma.subject.findUnique({
    where: { id: subjectId },
    select: {
      id: true,
      code: true,
      name: true,
      description: true,
      creditHours: true,
      attendanceLimit: true,
      createdAt: true,
      department: { select: { name: true, code: true } },
      academicTerm: { select: { name: true } },
      professors: {
        select: {
          isPrimary: true,
          professor: {
            select: {
              id: true,
              employeeCode: true,
              user: { select: { fullName: true, email: true } },
            },
          },
        },
      },
      enrollments: {
        where: { status: "ACTIVE" },
        orderBy: { enrolledAt: "asc" },
        select: {
          id: true,
          enrolledAt: true,
          student: {
            select: {
              id: true,
              universityId: true,
              academicYear: true,
              user: { select: { fullName: true, email: true } },
              department: { select: { name: true } },
            },
          },
        },
      },
      exams: {
        orderBy: { startsAt: "desc" },
        select: {
          id: true,
          title: true,
          status: true,
          totalScore: true,
          startsAt: true,
          _count: { select: { attempts: true, questions: true } },
        },
      },
      questions: { select: { id: true, type: true, difficulty: true } },
      attendance: {
        orderBy: { date: "desc" },
        take: 10,
        select: {
          id: true,
          date: true,
          title: true,
          _count: { select: { records: true } },
        },
      },
    },
  });

  if (!subject) return null;

  const studentIds = subject.enrollments.map((enrollment) => enrollment.student.id);

  const [attendanceRows, gradedAttempts] = await Promise.all([
    studentIds.length
      ? prisma.attendanceRecord.groupBy({
          by: ["studentId", "status"],
          where: { studentId: { in: studentIds }, session: { subjectId } },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    studentIds.length
      ? prisma.examAttempt.findMany({
          where: {
            studentId: { in: studentIds },
            status: "GRADED",
            exam: { subjectId },
          },
          select: { studentId: true, score: true, exam: { select: { totalScore: true } } },
        })
      : Promise.resolve([]),
  ]);

  const countsByStudent = new Map<string, { status: AttendanceStatus; count: number }[]>();
  for (const row of attendanceRows) {
    const list = countsByStudent.get(row.studentId) ?? [];
    list.push({ status: row.status, count: row._count._all });
    countsByStudent.set(row.studentId, list);
  }

  const scoresByStudent = new Map<string, { earned: number; total: number }>();
  for (const attempt of gradedAttempts) {
    const current = scoresByStudent.get(attempt.studentId) ?? { earned: 0, total: 0 };
    current.earned += attempt.score ?? 0;
    current.total += attempt.exam.totalScore;
    scoresByStudent.set(attempt.studentId, current);
  }

  const students: EnrolledStudent[] = subject.enrollments.map((enrollment) => {
    const scores = scoresByStudent.get(enrollment.student.id);
    return {
      enrollmentId: enrollment.id,
      studentId: enrollment.student.id,
      fullName: enrollment.student.user.fullName,
      email: enrollment.student.user.email,
      universityId: enrollment.student.universityId,
      academicYear: enrollment.student.academicYear,
      departmentName: enrollment.student.department.name,
      enrolledAt: enrollment.enrolledAt,
      attendance: summarizeAttendanceCounts(countsByStudent.get(enrollment.student.id) ?? []),
      averageScore: scores ? percentOf(scores.earned, scores.total) : null,
    };
  });

  const primary = subject.professors.find((link) => link.isPrimary) ?? subject.professors[0];

  const questionsByType: Record<QuestionType, number> = {
    MULTIPLE_CHOICE: 0,
    TRUE_FALSE: 0,
    SHORT_ANSWER: 0,
    ESSAY: 0,
  };
  for (const question of subject.questions) questionsByType[question.type]++;

  return {
    id: subject.id,
    code: subject.code,
    name: subject.name,
    description: subject.description,
    creditHours: subject.creditHours,
    attendanceLimit: subject.attendanceLimit,
    createdAt: subject.createdAt,
    departmentName: subject.department.name,
    departmentCode: subject.department.code,
    academicTermName: subject.academicTerm.name,
    professorName: primary?.professor.user.fullName ?? null,
    professorEmail: primary?.professor.user.email ?? null,
    professorsCount: subject.professors.length,
    students,
    lowAttendanceCount: students.filter(
      (student) => (student.attendance.percentage ?? 100) < subject.attendanceLimit,
    ).length,
    averageAttendance: averageOf(students.map((student) => student.attendance.percentage)),
    averageScore: averageOf(students.map((student) => student.averageScore)),
    exams: subject.exams.map((exam) => ({
      id: exam.id,
      title: exam.title,
      status: exam.status,
      totalScore: exam.totalScore,
      startsAt: exam.startsAt,
      attempts: exam._count.attempts,
      questions: exam._count.questions,
    })),
    questionsCount: subject.questions.length,
    questionsByType,
    recentSessions: subject.attendance.map((session) => ({
      id: session.id,
      date: session.date,
      title: session.title,
      records: session._count.records,
    })),
  };
}

export type EnrollableStudent = {
  id: string;
  fullName: string;
  email: string;
  universityId: string;
  academicYear: number;
  departmentName: string;
  isEnrolled: boolean;
};

export async function getEnrollableStudents(
  subjectId: string,
  query?: string,
): Promise<EnrollableStudent[]> {
  const search = query?.trim();

  const [students, enrollments] = await Promise.all([
    prisma.student.findMany({
      where: search
        ? {
            OR: [
              { user: { fullName: { contains: search, mode: "insensitive" as const } } },
              { universityId: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : undefined,
      orderBy: { user: { fullName: "asc" } },
      take: 40,
      select: {
        id: true,
        universityId: true,
        academicYear: true,
        user: { select: { fullName: true, email: true } },
        department: { select: { name: true } },
      },
    }),
    prisma.enrollment.findMany({
      where: { subjectId, status: "ACTIVE" },
      select: { studentId: true },
    }),
  ]);

  const enrolledIds = new Set(enrollments.map((enrollment) => enrollment.studentId));

  return students.map((student) => ({
    id: student.id,
    fullName: student.user.fullName,
    email: student.user.email,
    universityId: student.universityId,
    academicYear: student.academicYear,
    departmentName: student.department.name,
    isEnrolled: enrolledIds.has(student.id),
  }));
}
