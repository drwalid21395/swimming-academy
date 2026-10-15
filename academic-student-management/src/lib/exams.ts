import { ExamStatus, Prisma, QuestionType } from "@prisma/client";
import { z } from "zod";

import { distributeExamScores } from "@/lib/exam-scores";
import { percentOf } from "@/lib/format";
import { prisma } from "@/lib/prisma";

export const questionTypeEnum = z.enum([
  "MULTIPLE_CHOICE",
  "TRUE_FALSE",
  "SHORT_ANSWER",
  "ESSAY",
]);

export const difficultyEnum = z.enum(["EASY", "MEDIUM", "HARD"]);

export const examStatusEnum = z.enum(["DRAFT", "PUBLISHED", "CLOSED", "ARCHIVED"]);

export const examFormSchema = z
  .object({
    subjectId: z.string().min(1, "المادة مطلوبة."),
    createdById: z.string().min(1, "عضو هيئة التدريس مطلوب."),
    title: z.string().trim().min(3, "عنوان الامتحان مطلوب.").max(150),
    description: z.string().trim().max(500).optional().or(z.literal("")),
    startsAt: z.string().min(1, "موعد البداية مطلوب."),
    endsAt: z.string().min(1, "موعد النهاية مطلوب."),
    durationMin: z.coerce
      .number({ invalid_type_error: "المدة غير صحيحة." })
      .int("المدة غير صحيحة.")
      .min(1, "المدة غير صحيحة.")
      .max(600, "المدة غير صحيحة."),
    totalScore: z.coerce
      .number({ invalid_type_error: "الدرجة الكلية غير صحيحة." })
      .min(1, "الدرجة الكلية غير صحيحة.")
      .max(1000, "الدرجة الكلية غير صحيحة."),
  })
  .refine((value) => new Date(value.endsAt) > new Date(value.startsAt), {
    message: "موعد النهاية يجب أن يكون بعد البداية.",
    path: ["endsAt"],
  });

export type ExamFormValues = z.infer<typeof examFormSchema>;

export const questionFormSchema = z.object({
  subjectId: z.string().min(1, "المادة مطلوبة."),
  createdById: z.string().min(1, "عضو هيئة التدريس مطلوب."),
  categoryId: z.string().optional().or(z.literal("")),
  text: z.string().trim().min(5, "نص السؤال مطلوب.").max(1000),
  type: questionTypeEnum,
  difficulty: difficultyEnum,
  unit: z.string().trim().max(80).optional().or(z.literal("")),
  chapter: z.string().trim().max(80).optional().or(z.literal("")),
  correctAnswer: z.string().trim().max(500).optional().or(z.literal("")),
  explanation: z.string().trim().max(500).optional().or(z.literal("")),
});

export type QuestionFormValues = z.infer<typeof questionFormSchema>;

export const attachQuestionsSchema = z.object({
  examId: z.string().min(1),
  questionIds: z.array(z.string().min(1)).min(1, "اختر سؤالاً واحداً على الأقل."),
});

export type ExamFilters = {
  query?: string;
  subjectId?: string;
  status?: ExamStatus;
  page?: number;
  pageSize?: number;
};

export type QuestionFilters = {
  query?: string;
  subjectId?: string;
  type?: QuestionType;
  difficulty?: "EASY" | "MEDIUM" | "HARD";
  page?: number;
  pageSize?: number;
};

export type SearchParams = Record<string, string | string[] | undefined>;

function readParam(params: SearchParams, key: string) {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

function readNumber(value: string | undefined) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseExamFilters(params: SearchParams): ExamFilters {
  const status = readParam(params, "status");
  const parsedStatus = examStatusEnum.safeParse(status);

  return {
    query: readParam(params, "query")?.trim() || undefined,
    subjectId: readParam(params, "subjectId") || undefined,
    status: parsedStatus.success ? parsedStatus.data : undefined,
    page: readNumber(readParam(params, "page")) ?? 1,
    pageSize: readNumber(readParam(params, "pageSize")) ?? 10,
  };
}

export function parseQuestionFilters(params: SearchParams): QuestionFilters {
  const type = questionTypeEnum.safeParse(readParam(params, "type"));
  const difficulty = difficultyEnum.safeParse(readParam(params, "difficulty"));

  return {
    query: readParam(params, "query")?.trim() || undefined,
    subjectId: readParam(params, "subjectId") || undefined,
    type: type.success ? type.data : undefined,
    difficulty: difficulty.success ? difficulty.data : undefined,
    page: readNumber(readParam(params, "page")) ?? 1,
    pageSize: readNumber(readParam(params, "pageSize")) ?? 12,
  };
}

export type ExamListItem = {
  id: string;
  title: string;
  description: string | null;
  status: ExamStatus;
  startsAt: Date;
  endsAt: Date;
  durationMin: number;
  totalScore: number;
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  professorName: string;
  questionsCount: number;
  questionsScore: number;
  attemptsCount: number;
  gradedCount: number;
  averageScore: number | null;
  studentsCount: number;
};

export type ExamListResult = {
  rows: ExamListItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  totalExams: number;
  publishedExams: number;
  draftExams: number;
  questionsCount: number;
  gradedAttempts: number;
  averageScore: number | null;
};

export async function listExams(filters: ExamFilters): Promise<ExamListResult> {
  const pageSize = Math.min(50, Math.max(5, filters.pageSize ?? 10));
  const page = Math.max(1, filters.page ?? 1);
  const query = filters.query?.trim();

  const where: Prisma.ExamWhereInput = {
    ...(filters.subjectId ? { subjectId: filters.subjectId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
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

  const [total, totalExams, publishedExams, draftExams, questionsCount, gradedGlobal, exams] =
    await Promise.all([
      prisma.exam.count({ where }),
      prisma.exam.count(),
      prisma.exam.count({ where: { status: "PUBLISHED" } }),
      prisma.exam.count({ where: { status: "DRAFT" } }),
      prisma.question.count(),
      prisma.examAttempt.findMany({
        where: { status: "GRADED", score: { not: null } },
        select: { score: true, exam: { select: { totalScore: true } } },
        take: 2000,
      }),
      prisma.exam.findMany({
        where,
        orderBy: [{ startsAt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          title: true,
          description: true,
          status: true,
          startsAt: true,
          endsAt: true,
          durationMin: true,
          totalScore: true,
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
          questions: { select: { score: true } },
          attempts: {
            select: { status: true, score: true, exam: { select: { totalScore: true } } },
          },
        },
      }),
    ]);

  const rows: ExamListItem[] = exams.map((exam) => {
    const graded = exam.attempts.filter(
      (attempt) => attempt.status === "GRADED" && attempt.score !== null,
    );
    const earned = graded.reduce((sum, attempt) => sum + (attempt.score ?? 0), 0);
    const possible = graded.reduce((sum, attempt) => sum + attempt.exam.totalScore, 0);
    const questionsScore = exam.questions.reduce((sum, item) => sum + item.score, 0);

    return {
      id: exam.id,
      title: exam.title,
      description: exam.description,
      status: exam.status,
      startsAt: exam.startsAt,
      endsAt: exam.endsAt,
      durationMin: exam.durationMin,
      totalScore: exam.totalScore,
      subjectId: exam.subject.id,
      subjectName: exam.subject.name,
      subjectCode: exam.subject.code,
      professorName:
        exam.subject.professors[0]?.professor.user.fullName ?? exam.createdBy.user.fullName,
      questionsCount: exam.questions.length,
      questionsScore,
      attemptsCount: exam.attempts.length,
      gradedCount: graded.length,
      averageScore: percentOf(earned, possible),
      studentsCount: exam.subject.enrollments.length,
    };
  });

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const globalEarned = gradedGlobal.reduce((sum, attempt) => sum + (attempt.score ?? 0), 0);
  const globalPossible = gradedGlobal.reduce((sum, attempt) => sum + attempt.exam.totalScore, 0);

  return {
    rows,
    total,
    page: Math.min(page, pageCount),
    pageSize,
    pageCount,
    totalExams,
    publishedExams,
    draftExams,
    questionsCount,
    gradedAttempts: gradedGlobal.length,
    averageScore: percentOf(globalEarned, globalPossible),
  };
}

export type ExamEditData = {
  id: string;
  title: string;
  description: string | null;
  subjectId: string;
  createdById: string;
  startsAt: string;
  endsAt: string;
  durationMin: number;
  totalScore: number;
  status: ExamStatus;
};

function toInputDateTime(value: Date) {
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(
    value.getHours(),
  )}:${pad(value.getMinutes())}`;
}

export async function getExamForEdit(examId: string): Promise<ExamEditData | null> {
  const exam = await prisma.exam.findUnique({
    where: { id: examId },
    select: {
      id: true,
      title: true,
      description: true,
      subjectId: true,
      createdById: true,
      startsAt: true,
      endsAt: true,
      durationMin: true,
      totalScore: true,
      status: true,
    },
  });

  if (!exam) return null;

  return {
    id: exam.id,
    title: exam.title,
    description: exam.description,
    subjectId: exam.subjectId,
    createdById: exam.createdById,
    startsAt: toInputDateTime(exam.startsAt),
    endsAt: toInputDateTime(exam.endsAt),
    durationMin: exam.durationMin,
    totalScore: exam.totalScore,
    status: exam.status,
  };
}

async function assertExamReferences(subjectId: string, createdById: string) {
  const [subject, professor] = await Promise.all([
    prisma.subject.findUnique({ where: { id: subjectId }, select: { id: true } }),
    prisma.professor.findUnique({ where: { id: createdById }, select: { id: true } }),
  ]);

  if (!subject) throw new Error("المادة غير موجودة.");
  if (!professor) throw new Error("عضو هيئة التدريس غير موجود.");
}

export async function createExam(input: ExamFormValues, actorId: string) {
  await assertExamReferences(input.subjectId, input.createdById);

  return prisma.$transaction(async (tx) => {
    const exam = await tx.exam.create({
      data: {
        subjectId: input.subjectId,
        createdById: input.createdById,
        title: input.title.trim(),
        description: input.description?.trim() ? input.description.trim() : null,
        startsAt: new Date(input.startsAt),
        endsAt: new Date(input.endsAt),
        durationMin: input.durationMin,
        totalScore: input.totalScore,
        status: "DRAFT",
      },
      select: { id: true, title: true },
    });

    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "exam.create",
        entity: "Exam",
        entityId: exam.id,
        metadata: { title: exam.title },
      },
    });

    return exam;
  });
}

/**
 * Creates a draft exam and attaches the given questions in one step, splitting the
 * total score between them. Every question must belong to the exam subject.
 */
export async function createExamWithQuestions(
  input: ExamFormValues,
  questionIds: string[],
  actorId: string,
) {
  const uniqueIds = Array.from(new Set(questionIds.map((id) => id.trim()).filter(Boolean)));
  if (uniqueIds.length === 0) throw new Error("اختر سؤالاً واحداً على الأقل لبناء الامتحان.");

  await assertExamReferences(input.subjectId, input.createdById);

  const found = await prisma.question.findMany({
    where: { id: { in: uniqueIds } },
    select: { id: true, subjectId: true },
  });
  const byId = new Map(found.map((question) => [question.id, question]));

  if (found.length !== uniqueIds.length) {
    throw new Error("بعض الأسئلة المحددة لم تعد موجودة في بنك الأسئلة.");
  }

  const ordered = uniqueIds.map((id) => byId.get(id)!);
  if (ordered.some((question) => question.subjectId !== input.subjectId)) {
    throw new Error("جميع الأسئلة المحددة يجب أن تخص مادة الامتحان نفسها.");
  }

  const scores = distributeExamScores(input.totalScore, ordered.length);

  return prisma.$transaction(async (tx) => {
    const exam = await tx.exam.create({
      data: {
        subjectId: input.subjectId,
        createdById: input.createdById,
        title: input.title.trim(),
        description: input.description?.trim() ? input.description.trim() : null,
        startsAt: new Date(input.startsAt),
        endsAt: new Date(input.endsAt),
        durationMin: input.durationMin,
        totalScore: input.totalScore,
        status: "DRAFT",
      },
      select: { id: true, title: true },
    });

    for (const [index, question] of ordered.entries()) {
      await tx.examQuestion.create({
        data: {
          examId: exam.id,
          questionId: question.id,
          position: index + 1,
          score: scores[index],
        },
      });
    }

    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "exam.create",
        entity: "Exam",
        entityId: exam.id,
        metadata: { title: exam.title, questions: ordered.length, fromQuestionBank: true },
      },
    });

    return { id: exam.id, title: exam.title, questions: ordered.length };
  });
}

export async function updateExam(examId: string, input: ExamFormValues, actorId: string) {
  await assertExamReferences(input.subjectId, input.createdById);

  const exam = await prisma.exam.findUnique({
    where: { id: examId },
    select: { status: true, questions: { select: { score: true } } },
  });

  if (!exam) throw new Error("الامتحان غير موجود.");
  if (exam.status !== "DRAFT" && exam.questions.length > 0) {
    throw new Error("لا يمكن تعديل بيانات امتحان تم نشره. ألغِ النشر أولاً.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.exam.update({
      where: { id: examId },
      data: {
        subjectId: input.subjectId,
        createdById: input.createdById,
        title: input.title.trim(),
        description: input.description?.trim() ? input.description.trim() : null,
        startsAt: new Date(input.startsAt),
        endsAt: new Date(input.endsAt),
        durationMin: input.durationMin,
        totalScore: input.totalScore,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "exam.update",
        entity: "Exam",
        entityId: examId,
        metadata: { title: input.title.trim() },
      },
    });
  });
}

export async function setExamStatus(
  examId: string,
  status: Extract<ExamStatus, "PUBLISHED" | "CLOSED" | "DRAFT">,
  actorId: string,
) {
  const exam = await prisma.exam.findUnique({
    where: { id: examId },
    select: { id: true, title: true, status: true, questions: { select: { questionId: true } } },
  });

  if (!exam) throw new Error("الامتحان غير موجود.");

  if (status === "PUBLISHED") {
    if (exam.questions.length === 0) {
      throw new Error("أضف سؤالاً واحداً على الأقل قبل نشر الامتحان.");
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.exam.update({ where: { id: examId }, data: { status } });
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: status === "PUBLISHED" ? "exam.publish" : status === "CLOSED" ? "exam.close" : "exam.update",
        entity: "Exam",
        entityId: examId,
        metadata: { title: exam.title, status },
      },
    });
  });
}

export async function deleteExam(examId: string, actorId: string) {
  const exam = await prisma.exam.findUnique({
    where: { id: examId },
    select: { id: true, title: true, _count: { select: { attempts: true } } },
  });

  if (!exam) throw new Error("الامتحان غير موجود.");
  if (exam._count.attempts > 0) {
    throw new Error("لا يمكن حذف امتحان لديه محاولات طلاب. أغلق الامتحان بدلاً من ذلك.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "exam.delete",
        entity: "Exam",
        entityId: examId,
        metadata: { title: exam.title },
      },
    });

    await tx.exam.delete({ where: { id: examId } });
  });
}

export type ExamQuestionItem = {
  questionId: string;
  position: number;
  score: number;
  text: string;
  type: QuestionType;
  difficulty: "EASY" | "MEDIUM" | "HARD";
  unit: string | null;
};

export type ExamDetail = {
  id: string;
  title: string;
  description: string | null;
  status: ExamStatus;
  startsAt: Date;
  endsAt: Date;
  durationMin: number;
  totalScore: number;
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  professorName: string;
  questions: ExamQuestionItem[];
  questionsScore: number;
  studentsCount: number;
  attemptsCount: number;
  gradedCount: number;
  submittedCount: number;
  averageScore: number | null;
  isOpen: boolean;
};

export async function getExamDetail(examId: string): Promise<ExamDetail | null> {
  const exam = await prisma.exam.findUnique({
    where: { id: examId },
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      startsAt: true,
      endsAt: true,
      durationMin: true,
      totalScore: true,
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
      questions: {
        orderBy: { position: "asc" },
        select: {
          position: true,
          score: true,
          question: {
            select: {
              id: true,
              text: true,
              type: true,
              difficulty: true,
              unit: true,
            },
          },
        },
      },
      attempts: { select: { status: true, score: true } },
    },
  });

  if (!exam) return null;

  const graded = exam.attempts.filter(
    (attempt) => attempt.status === "GRADED" && attempt.score !== null,
  );
  const questionsScore = exam.questions.reduce((sum, item) => sum + item.score, 0);
  const now = new Date();

  return {
    id: exam.id,
    title: exam.title,
    description: exam.description,
    status: exam.status,
    startsAt: exam.startsAt,
    endsAt: exam.endsAt,
    durationMin: exam.durationMin,
    totalScore: exam.totalScore,
    subjectId: exam.subject.id,
    subjectName: exam.subject.name,
    subjectCode: exam.subject.code,
    professorName:
      exam.subject.professors[0]?.professor.user.fullName ?? exam.createdBy.user.fullName,
    questions: exam.questions.map((item) => ({
      questionId: item.question.id,
      position: item.position,
      score: item.score,
      text: item.question.text,
      type: item.question.type,
      difficulty: item.question.difficulty,
      unit: item.question.unit,
    })),
    questionsScore,
    studentsCount: exam.subject.enrollments.length,
    attemptsCount: exam.attempts.length,
    gradedCount: graded.length,
    submittedCount: exam.attempts.filter((attempt) => attempt.status !== "IN_PROGRESS").length,
    averageScore: percentOf(
      graded.reduce((sum, attempt) => sum + (attempt.score ?? 0), 0),
      graded.length * exam.totalScore,
    ),
    isOpen: exam.status === "PUBLISHED" && now >= exam.startsAt && now <= exam.endsAt,
  };
}

export async function attachQuestionsToExam(
  examId: string,
  questionIds: string[],
  actorId: string,
) {
  const exam = await prisma.exam.findUnique({
    where: { id: examId },
    select: {
      id: true,
      title: true,
      status: true,
      subjectId: true,
      questions: { select: { questionId: true } },
    },
  });

  if (!exam) throw new Error("الامتحان غير موجود.");
  if (exam.status !== "DRAFT") {
    throw new Error("يمكن تعديل أسئلة الامتحان في حالة المسودة فقط.");
  }

  const existing = new Set(exam.questions.map((item) => item.questionId));
  const fresh = questionIds.filter((questionId) => !existing.has(questionId));

  if (fresh.length === 0) throw new Error("الأسئلة المختارة موجودة في الامتحان بالفعل.");

  const questions = await prisma.question.findMany({
    where: { id: { in: fresh }, subjectId: exam.subjectId },
    select: { id: true },
  });

  if (questions.length !== fresh.length) {
    throw new Error("بعض الأسئلة المختارة لا تنتمي لنفس مادة الامتحان.");
  }

  const startPosition = exam.questions.length;

  await prisma.$transaction(async (tx) => {
    for (const [index, question] of questions.entries()) {
      await tx.examQuestion.create({
        data: {
          examId,
          questionId: question.id,
          position: startPosition + index + 1,
          score: 0,
        },
      });
    }

    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "exam.questions.update",
        entity: "Exam",
        entityId: examId,
        metadata: { added: questions.length, title: exam.title },
      },
    });
  });

  return { added: questions.length, skipped: questionIds.length - fresh.length };
}

export async function removeQuestionFromExam(
  examId: string,
  questionId: string,
  actorId: string,
) {
  const exam = await prisma.exam.findUnique({
    where: { id: examId },
    select: { id: true, status: true },
  });

  if (!exam) throw new Error("الامتحان غير موجود.");
  if (exam.status !== "DRAFT") {
    throw new Error("يمكن تعديل أسئلة الامتحان في حالة المسودة فقط.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.examQuestion.delete({ where: { examId_questionId: { examId, questionId } } });

    const remaining = await tx.examQuestion.findMany({
      where: { examId },
      orderBy: { position: "asc" },
      select: { questionId: true },
    });

    for (const [index, item] of remaining.entries()) {
      await tx.examQuestion.update({
        where: { examId_questionId: { examId, questionId: item.questionId } },
        data: { position: index + 1 },
      });
    }

    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "exam.questions.update",
        entity: "Exam",
        entityId: examId,
        metadata: { removed: 1 },
      },
    });
  });
}

export async function updateExamQuestionScore(
  examId: string,
  questionId: string,
  score: number,
  actorId: string,
) {
  const exam = await prisma.exam.findUnique({
    where: { id: examId },
    select: { id: true, status: true },
  });

  if (!exam) throw new Error("الامتحان غير موجود.");
  if (exam.status !== "DRAFT") {
    throw new Error("يمكن تعديل درجات أسئلة الامتحان في حالة المسودة فقط.");
  }
  if (!Number.isFinite(score) || score < 0 || score > 1000) {
    throw new Error("درجة السؤال غير صحيحة.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.examQuestion.update({
      where: { examId_questionId: { examId, questionId } },
      data: { score },
    });

    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "exam.questions.update",
        entity: "Exam",
        entityId: examId,
        metadata: { questionId, score },
      },
    });
  });
}

export type QuestionListItem = {
  id: string;
  text: string;
  type: QuestionType;
  difficulty: "EASY" | "MEDIUM" | "HARD";
  unit: string | null;
  chapter: string | null;
  correctAnswer: string | null;
  explanation: string | null;
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  categoryName: string | null;
  professorName: string;
  options: { id: string; text: string; isCorrect: boolean }[];
  optionsCount: number;
  usedInExams: number;
  createdAt: Date;
};

export type QuestionListResult = {
  rows: QuestionListItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  totalQuestions: number;
  byType: Record<QuestionType, number>;
  unusedQuestions: number;
};

export async function listQuestions(
  filters: QuestionFilters,
  scope?: { subjectIds?: string[] },
): Promise<QuestionListResult> {
  const pageSize = Math.min(50, Math.max(5, filters.pageSize ?? 12));
  const page = Math.max(1, filters.page ?? 1);
  const query = filters.query?.trim();
  const scopeWhere: Prisma.QuestionWhereInput = scope?.subjectIds
    ? { subjectId: { in: scope.subjectIds } }
    : {};

  const where: Prisma.QuestionWhereInput = {
    ...scopeWhere,
    ...(filters.subjectId ? { subjectId: filters.subjectId } : {}),
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.difficulty ? { difficulty: filters.difficulty } : {}),
    ...(query
      ? {
          OR: [
            { text: { contains: query, mode: "insensitive" as const } },
            { unit: { contains: query, mode: "insensitive" as const } },
            { chapter: { contains: query, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [total, totalQuestions, typeGroups, unused, questions] = await Promise.all([
    prisma.question.count({ where }),
    prisma.question.count({ where: scopeWhere }),
    prisma.question.groupBy({ by: ["type"], _count: { _all: true }, where: scopeWhere }),
    prisma.question.count({ where: { ...scopeWhere, examQuestions: { none: {} } } }),
    prisma.question.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        text: true,
        type: true,
        difficulty: true,
        unit: true,
        chapter: true,
        correctAnswer: true,
        explanation: true,
        createdAt: true,
        subject: { select: { id: true, name: true, code: true } },
        category: { select: { name: true } },
        createdBy: { select: { user: { select: { fullName: true } } } },
        options: {
          orderBy: { position: "asc" },
          select: { id: true, text: true, isCorrect: true },
        },
        _count: { select: { examQuestions: true } },
      },
    }),
  ]);

  const byType = {
    MULTIPLE_CHOICE: 0,
    TRUE_FALSE: 0,
    SHORT_ANSWER: 0,
    ESSAY: 0,
  } as Record<QuestionType, number>;

  for (const group of typeGroups) byType[group.type] = group._count._all;

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return {
    rows: questions.map((question) => ({
      id: question.id,
      text: question.text,
      type: question.type,
      difficulty: question.difficulty,
      unit: question.unit,
      chapter: question.chapter,
      correctAnswer: question.correctAnswer,
      explanation: question.explanation,
      subjectId: question.subject.id,
      subjectName: question.subject.name,
      subjectCode: question.subject.code,
      categoryName: question.category?.name ?? null,
      professorName: question.createdBy.user.fullName,
      options: question.options,
      optionsCount: question.options.length,
      usedInExams: question._count.examQuestions,
      createdAt: question.createdAt,
    })),
    total,
    page: Math.min(page, pageCount),
    pageSize,
    pageCount,
    totalQuestions,
    byType,
    unusedQuestions: unused,
  };
}

export type QuestionEditData = {
  id: string;
  subjectId: string;
  createdById: string;
  categoryId: string | null;
  text: string;
  type: QuestionType;
  difficulty: "EASY" | "MEDIUM" | "HARD";
  unit: string | null;
  chapter: string | null;
  correctAnswer: string | null;
  explanation: string | null;
  options: { id: string; text: string; isCorrect: boolean; position: number }[];
};

export async function getQuestionForEdit(
  questionId: string,
  scope?: { subjectIds?: string[] },
): Promise<QuestionEditData | null> {
  const question = await prisma.question.findFirst({
    where: {
      id: questionId,
      ...(scope?.subjectIds ? { subjectId: { in: scope.subjectIds } } : {}),
    },
    select: {
      id: true,
      subjectId: true,
      createdById: true,
      categoryId: true,
      text: true,
      type: true,
      difficulty: true,
      unit: true,
      chapter: true,
      correctAnswer: true,
      explanation: true,
      options: { orderBy: { position: "asc" }, select: { id: true, text: true, isCorrect: true, position: true } },
      createdBy: { select: { id: true } },
    },
  });

  if (!question) return null;

  return {
    id: question.id,
    subjectId: question.subjectId,
    createdById: question.createdById,
    categoryId: question.categoryId,
    text: question.text,
    type: question.type,
    difficulty: question.difficulty,
    unit: question.unit,
    chapter: question.chapter,
    correctAnswer: question.correctAnswer,
    explanation: question.explanation,
    options: question.options,
  };
}

export type QuestionOptionInput = { text: string; isCorrect: boolean };

function normalizeOptions(type: QuestionType, options: QuestionOptionInput[]) {
  const filled = options
    .map((option) => ({ text: option.text.trim(), isCorrect: option.isCorrect }))
    .filter((option) => option.text.length > 0);

  if (type === "MULTIPLE_CHOICE" && filled.length < 2) {
    throw new Error("سؤال الاختيار من متعدد يحتاج خيارين على الأقل.");
  }

  if (type === "TRUE_FALSE" && filled.length !== 2) {
    throw new Error("سؤال الصح والخطأ يحتاج خيارين فقط.");
  }

  if (type === "MULTIPLE_CHOICE" || type === "TRUE_FALSE") {
    const correct = filled.filter((option) => option.isCorrect).length;

    if (correct === 0) throw new Error("حدد الإجابة الصحيحة من بين الخيارات.");
    if (correct > 1) throw new Error("لا يمكن تحديد أكثر من إجابة صحيحة.");
  }

  return filled.map((option, index) => ({ ...option, position: index + 1 }));
}

export async function createQuestion(input: QuestionFormValues, options: QuestionOptionInput[], actorId: string) {
  await assertExamReferences(input.subjectId, input.createdById);
  const normalized = normalizeOptions(input.type, options);

  if (input.categoryId) {
    const category = await prisma.questionCategory.findFirst({
      where: { id: input.categoryId, subjectId: input.subjectId },
      select: { id: true },
    });

    if (!category) throw new Error("تصنيف السؤال لا ينتمي للمادة المختارة.");
  }

  return prisma.$transaction(async (tx) => {
    const question = await tx.question.create({
      data: {
        subjectId: input.subjectId,
        createdById: input.createdById,
        categoryId: input.categoryId ? input.categoryId : null,
        text: input.text.trim(),
        type: input.type,
        difficulty: input.difficulty,
        unit: input.unit?.trim() ? input.unit.trim() : null,
        chapter: input.chapter?.trim() ? input.chapter.trim() : null,
        correctAnswer: input.correctAnswer?.trim() ? input.correctAnswer.trim() : null,
        explanation: input.explanation?.trim() ? input.explanation.trim() : null,
        options: { create: normalized },
      },
      select: { id: true, text: true },
    });

    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "question.create",
        entity: "Question",
        entityId: question.id,
        metadata: { type: input.type },
      },
    });

    return question;
  });
}

export async function updateQuestion(
  questionId: string,
  input: QuestionFormValues,
  options: QuestionOptionInput[],
  actorId: string,
) {
  await assertExamReferences(input.subjectId, input.createdById);
  const normalized = normalizeOptions(input.type, options);

  const question = await prisma.question.findUnique({
    where: { id: questionId },
    select: { id: true, _count: { select: { examQuestions: true } } },
  });

  if (!question) throw new Error("السؤال غير موجود.");
  if (question._count.examQuestions > 0) {
    throw new Error("لا يمكن تعديل سؤال مستخدم في امتحان. احذفه من الامتحان أولاً.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.questionOption.deleteMany({ where: { questionId } });

    await tx.question.update({
      where: { id: questionId },
      data: {
        subjectId: input.subjectId,
        createdById: input.createdById,
        categoryId: input.categoryId ? input.categoryId : null,
        text: input.text.trim(),
        type: input.type,
        difficulty: input.difficulty,
        unit: input.unit?.trim() ? input.unit.trim() : null,
        chapter: input.chapter?.trim() ? input.chapter.trim() : null,
        correctAnswer: input.correctAnswer?.trim() ? input.correctAnswer.trim() : null,
        explanation: input.explanation?.trim() ? input.explanation.trim() : null,
        options: { create: normalized },
      },
    });

    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "question.update",
        entity: "Question",
        entityId: questionId,
        metadata: { type: input.type },
      },
    });
  });
}

export async function deleteQuestion(questionId: string, actorId: string) {
  const question = await prisma.question.findUnique({
    where: { id: questionId },
    select: { id: true, text: true, _count: { select: { examQuestions: true, answers: true } } },
  });

  if (!question) throw new Error("السؤال غير موجود.");
  if (question._count.examQuestions > 0) {
    throw new Error("لا يمكن حذف سؤال مرتبط بامتحان.");
  }
  if (question._count.answers > 0) {
    throw new Error("لا يمكن حذف سؤال له إجابات طلاب.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "question.delete",
        entity: "Question",
        entityId: questionId,
        metadata: { text: question.text.slice(0, 80) },
      },
    });

    await tx.question.delete({ where: { id: questionId } });
  });
}

export async function getQuestionCategories(
  subjectId?: string,
  scope?: { subjectIds?: string[] },
) {
  return prisma.questionCategory.findMany({
    where: {
      ...(subjectId ? { subjectId } : {}),
      ...(scope?.subjectIds ? { subjectId: { in: scope.subjectIds } } : {}),
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true, subjectId: true },
  });
}

export type BankQuestion = {
  id: string;
  text: string;
  type: QuestionType;
  difficulty: "EASY" | "MEDIUM" | "HARD";
};

export async function getBankQuestions(subjectId: string, take = 60): Promise<BankQuestion[]> {
  return prisma.question.findMany({
    where: { subjectId },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, text: true, type: true, difficulty: true },
  });
}
