import { AttemptStatus, QuestionType } from "@prisma/client";

import { percentOf } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { notifyUsers } from "@/lib/notifications";
import { isObjectiveQuestion } from "@/lib/student-exams";

export type ProfessorExamRow = {
  id: string;
  title: string;
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  status: string;
  startsAt: Date;
  endsAt: Date;
  durationMin: number;
  totalScore: number;
  questionsCount: number;
  attemptsCount: number;
  submittedCount: number;
  gradedCount: number;
  pendingCount: number;
  averagePercentage: number | null;
  highestPercentage: number | null;
};

export type ProfessorExamListResult = {
  rows: ProfessorExamRow[];
  total: number;
  publishedCount: number;
  draftCount: number;
  attemptsCount: number;
  pendingCount: number;
  gradedCount: number;
  averagePercentage: number | null;
};

function summarizeAttemptRows(attempts: { score: number | null; exam: { totalScore: number } }[]) {
  const graded = attempts.filter((attempt) => attempt.score !== null);
  const earned = graded.reduce((sum, attempt) => sum + (attempt.score ?? 0), 0);
  const possible = graded.reduce((sum, attempt) => sum + attempt.exam.totalScore, 0);
  const highest = graded.reduce((max, attempt) => {
    const value = percentOf(attempt.score ?? 0, attempt.exam.totalScore) ?? 0;
    return value > max ? value : max;
  }, 0);

  return {
    averagePercentage: percentOf(earned, possible),
    highestPercentage: graded.length > 0 ? highest : null,
  };
}

export async function listProfessorExams(
  subjectIds: string[],
  filters: { subjectId?: string; status?: string; query?: string } = {},
): Promise<ProfessorExamListResult> {
  if (subjectIds.length === 0) {
    return {
      rows: [],
      total: 0,
      publishedCount: 0,
      draftCount: 0,
      attemptsCount: 0,
      pendingCount: 0,
      gradedCount: 0,
      averagePercentage: null,
    };
  }

  const query = filters.query?.trim();

  const exams = await prisma.exam.findMany({
    where: {
      subjectId: { in: filters.subjectId ? [filters.subjectId] : subjectIds },
      status: filters.status ? (filters.status as "DRAFT") : undefined,
      ...(query
        ? {
            OR: [
              { title: { contains: query, mode: "insensitive" as const } },
              { subject: { name: { contains: query, mode: "insensitive" as const } } },
            ],
          }
        : {}),
    },
    orderBy: [{ startsAt: "desc" }],
    select: {
      id: true,
      title: true,
      status: true,
      startsAt: true,
      endsAt: true,
      durationMin: true,
      totalScore: true,
      subject: { select: { id: true, name: true, code: true } },
      _count: { select: { questions: true } },
      attempts: {
        select: { status: true, score: true, exam: { select: { totalScore: true } } },
      },
    },
  });

  const rows: ProfessorExamRow[] = exams.map((exam) => {
    const summary = summarizeAttemptRows(exam.attempts);

    return {
      id: exam.id,
      title: exam.title,
      subjectId: exam.subject.id,
      subjectName: exam.subject.name,
      subjectCode: exam.subject.code,
      status: exam.status,
      startsAt: exam.startsAt,
      endsAt: exam.endsAt,
      durationMin: exam.durationMin,
      totalScore: exam.totalScore,
      questionsCount: exam._count.questions,
      attemptsCount: exam.attempts.length,
      submittedCount: exam.attempts.filter((attempt) => attempt.status === "SUBMITTED").length,
      gradedCount: exam.attempts.filter((attempt) => attempt.status === "GRADED").length,
      pendingCount: exam.attempts.filter((attempt) => attempt.status === "SUBMITTED").length,
      ...summary,
    };
  });

  const allAttempts = exams.flatMap((exam) =>
    exam.attempts.map((attempt) => ({ score: attempt.score, exam: { totalScore: exam.totalScore } })),
  );
  const overall = summarizeAttemptRows(allAttempts);

  return {
    rows,
    total: rows.length,
    publishedCount: rows.filter((row) => row.status === "PUBLISHED").length,
    draftCount: rows.filter((row) => row.status === "DRAFT").length,
    attemptsCount: rows.reduce((sum, row) => sum + row.attemptsCount, 0),
    pendingCount: rows.reduce((sum, row) => sum + row.pendingCount, 0),
    gradedCount: rows.reduce((sum, row) => sum + row.gradedCount, 0),
    averagePercentage: overall.averagePercentage,
  };
}

export type ProfessorExamAttemptRow = {
  id: string;
  status: AttemptStatus;
  studentName: string;
  universityId: string | null;
  startedAt: Date;
  submittedAt: Date | null;
  score: number | null;
  percentage: number | null;
  answeredCount: number;
  unansweredCount: number;
  pendingReviewCount: number;
};

export type ProfessorExamDetail = {
  id: string;
  title: string;
  description: string | null;
  subjectName: string;
  subjectCode: string;
  status: string;
  startsAt: Date;
  endsAt: Date;
  durationMin: number;
  totalScore: number;
  createdByName: string | null;
  questions: {
    id: string;
    position: number;
    score: number;
    text: string;
    type: QuestionType;
  }[];
  attempts: ProfessorExamAttemptRow[];
  pendingCount: number;
  gradedCount: number;
  averagePercentage: number | null;
};

export async function getProfessorExamDetail(
  subjectIds: string[],
  examId: string,
): Promise<ProfessorExamDetail | null> {
  const exam = await prisma.exam.findFirst({
    where: { id: examId, subjectId: { in: subjectIds } },
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      startsAt: true,
      endsAt: true,
      durationMin: true,
      totalScore: true,
      subject: { select: { name: true, code: true } },
      createdBy: { select: { user: { select: { fullName: true } } } },
      questions: {
        orderBy: { position: "asc" },
        select: {
          position: true,
          score: true,
          question: { select: { id: true, text: true, type: true } },
        },
      },
      attempts: {
        orderBy: { submittedAt: "desc" },
        select: {
          id: true,
          status: true,
          score: true,
          startedAt: true,
          submittedAt: true,
          student: { select: { universityId: true, user: { select: { fullName: true } } } },
          answers: { select: { questionId: true, score: true } },
        },
      },
    },
  });

  if (!exam) return null;

  const subjectiveIds = new Set(
    exam.questions.filter((item) => !isObjectiveQuestion(item.question.type)).map((item) => item.question.id),
  );
  const totalQuestions = exam.questions.length;

  const attempts: ProfessorExamAttemptRow[] = exam.attempts.map((attempt) => {
    const answered = new Set(attempt.answers.map((answer) => answer.questionId));
    const pendingReview = subjectiveIds.size;

    return {
      id: attempt.id,
      status: attempt.status,
      studentName: attempt.student.user.fullName,
      universityId: attempt.student.universityId,
      startedAt: attempt.startedAt,
      submittedAt: attempt.submittedAt,
      score: attempt.score,
      percentage: percentOf(attempt.score ?? 0, exam.totalScore),
      answeredCount: answered.size,
      unansweredCount: Math.max(0, totalQuestions - answered.size),
      pendingReviewCount: attempt.status === "SUBMITTED" ? pendingReview : 0,
    };
  });

  const summary = summarizeAttemptRows(
    exam.attempts.map((attempt) => ({ score: attempt.score, exam: { totalScore: exam.totalScore } })),
  );

  return {
    id: exam.id,
    title: exam.title,
    description: exam.description,
    subjectName: exam.subject.name,
    subjectCode: exam.subject.code,
    status: exam.status,
    startsAt: exam.startsAt,
    endsAt: exam.endsAt,
    durationMin: exam.durationMin,
    totalScore: exam.totalScore,
    createdByName: exam.createdBy?.user.fullName ?? null,
    questions: exam.questions.map((item) => ({
      id: item.question.id,
      position: item.position,
      score: item.score,
      text: item.question.text,
      type: item.question.type,
    })),
    attempts,
    pendingCount: attempts.filter((attempt) => attempt.status === "SUBMITTED").length,
    gradedCount: attempts.filter((attempt) => attempt.status === "GRADED").length,
    averagePercentage: summary.averagePercentage,
  };
}

export type GradingQueueRow = {
  attemptId: string;
  examId: string;
  examTitle: string;
  subjectName: string;
  subjectCode: string;
  studentName: string;
  universityId: string | null;
  submittedAt: Date | null;
  autoScore: number | null;
  totalScore: number;
  pendingCount: number;
  totalQuestions: number;
  answeredCount: number;
};

export type GradingQueue = {
  rows: GradingQueueRow[];
  pendingAttempts: number;
  pendingQuestions: number;
};

export async function getGradingQueue(subjectIds: string[]): Promise<GradingQueue> {
  if (subjectIds.length === 0) return { rows: [], pendingAttempts: 0, pendingQuestions: 0 };

  const attempts = await prisma.examAttempt.findMany({
    where: { status: "SUBMITTED", exam: { subjectId: { in: subjectIds } } },
    orderBy: { submittedAt: "asc" },
    select: {
      id: true,
      submittedAt: true,
      score: true,
      student: { select: { universityId: true, user: { select: { fullName: true } } } },
      exam: {
        select: {
          id: true,
          title: true,
          totalScore: true,
          subject: { select: { name: true, code: true } },
          questions: { select: { question: { select: { id: true, type: true } } } },
        },
      },
      answers: { select: { questionId: true } },
    },
  });

  const rows: GradingQueueRow[] = attempts.map((attempt) => {
    const subjective = attempt.exam.questions.filter(
      (item) => !isObjectiveQuestion(item.question.type),
    ).length;

    return {
      attemptId: attempt.id,
      examId: attempt.exam.id,
      examTitle: attempt.exam.title,
      subjectName: attempt.exam.subject.name,
      subjectCode: attempt.exam.subject.code,
      studentName: attempt.student.user.fullName,
      universityId: attempt.student.universityId,
      submittedAt: attempt.submittedAt,
      autoScore: attempt.score,
      totalScore: attempt.exam.totalScore,
      pendingCount: subjective,
      totalQuestions: attempt.exam.questions.length,
      answeredCount: attempt.answers.length,
    };
  });

  return {
    rows,
    pendingAttempts: rows.length,
    pendingQuestions: rows.reduce((sum, row) => sum + row.pendingCount, 0),
  };
}

export type GradingSheetRow = {
  questionId: string;
  position: number;
  text: string;
  type: QuestionType;
  maxScore: number;
  options: { id: string; text: string; isCorrect: boolean }[];
  studentAnswer: string | null;
  awardedScore: number | null;
  isCorrect: boolean | null;
  feedback: string | null;
  modelAnswer: string | null;
  explanation: string | null;
  objective: boolean;
};

export type GradingSheet = {
  attemptId: string;
  examId: string;
  examTitle: string;
  subjectName: string;
  subjectCode: string;
  studentName: string;
  universityId: string | null;
  status: AttemptStatus;
  startedAt: Date;
  submittedAt: Date | null;
  autoScore: number;
  totalScore: number;
  rows: GradingSheetRow[];
  subjectiveCount: number;
  gradedSubjectiveCount: number;
  awardedSubjective: number;
  possibleSubjective: number;
  finalScore: number;
  isComplete: boolean;
};

async function loadGradingAttempt(subjectIds: string[], attemptId: string) {
  return prisma.examAttempt.findFirst({
    where: { id: attemptId, exam: { subjectId: { in: subjectIds } } },
    select: {
      id: true,
      status: true,
      score: true,
      startedAt: true,
      submittedAt: true,
      student: { select: { universityId: true, user: { select: { fullName: true } } } },
      exam: {
        select: {
          id: true,
          title: true,
          totalScore: true,
          subject: { select: { name: true, code: true } },
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
                  correctAnswer: true,
                  explanation: true,
                  options: {
                    orderBy: { position: "asc" },
                    select: { id: true, text: true, isCorrect: true },
                  },
                },
              },
            },
          },
        },
      },
      answers: {
        select: { questionId: true, answer: true, score: true, isCorrect: true, feedback: true },
      },
    },
  });
}

function toSheet(attempt: NonNullable<Awaited<ReturnType<typeof loadGradingAttempt>>>): GradingSheet {
  const answers = new Map(attempt.answers.map((row) => [row.questionId, row]));

  const rows: GradingSheetRow[] = attempt.exam.questions.map((item) => {
    const answer = answers.get(item.question.id);
    const objective = isObjectiveQuestion(item.question.type);

    return {
      questionId: item.question.id,
      position: item.position,
      text: item.question.text,
      type: item.question.type,
      maxScore: item.score,
      options: item.question.options,
      studentAnswer: answer?.answer ?? null,
      awardedScore: answer?.score ?? null,
      isCorrect: objective ? (answer?.isCorrect ?? null) : null,
      feedback: answer?.feedback ?? null,
      modelAnswer: item.question.correctAnswer,
      explanation: item.question.explanation,
      objective,
    };
  });

  const subjective = rows.filter((row) => !row.objective);
  const objectiveEarned = rows
    .filter((row) => row.objective)
    .reduce((sum, row) => sum + (row.awardedScore ?? 0), 0);
  const awardedSubjective = subjective.reduce((sum, row) => sum + (row.awardedScore ?? 0), 0);
  const gradedSubjectiveCount = subjective.filter((row) => row.awardedScore !== null).length;

  return {
    attemptId: attempt.id,
    examId: attempt.exam.id,
    examTitle: attempt.exam.title,
    subjectName: attempt.exam.subject.name,
    subjectCode: attempt.exam.subject.code,
    studentName: attempt.student.user.fullName,
    universityId: attempt.student.universityId,
    status: attempt.status,
    startedAt: attempt.startedAt,
    submittedAt: attempt.submittedAt,
    autoScore: objectiveEarned,
    totalScore: attempt.exam.totalScore,
    rows,
    subjectiveCount: subjective.length,
    gradedSubjectiveCount,
    awardedSubjective,
    possibleSubjective: subjective.reduce((sum, row) => sum + row.maxScore, 0),
    finalScore: objectiveEarned + awardedSubjective,
    isComplete: subjective.length === gradedSubjectiveCount,
  };
}

export async function getGradingSheet(
  subjectIds: string[],
  attemptId: string,
): Promise<GradingSheet | null> {
  const attempt = await loadGradingAttempt(subjectIds, attemptId);
  if (!attempt) return null;
  if (attempt.status === "IN_PROGRESS") return null;
  return toSheet(attempt);
}

function clampScore(value: number, max: number) {
  return Math.min(max, Math.max(0, value));
}

export type SaveGradesResult = {
  score: number;
  totalScore: number;
  percentage: number | null;
  gradedQuestions: number;
  attemptStatus: AttemptStatus;
  savedAt: Date;
};

export async function saveAttemptGrades(
  actor: { professorId: string; userId: string; subjectIds: string[] },
  attemptId: string,
  formData: FormData,
): Promise<SaveGradesResult> {
  const attempt = await loadGradingAttempt(actor.subjectIds, attemptId);
  if (!attempt) throw new Error("المحاولة غير موجودة أو لا تخص موادك.");
  if (attempt.status === "IN_PROGRESS") throw new Error("لم يسلّم الطالب إجاباته بعد.");

  const sheet = toSheet(attempt);
  const subjectiveRows = sheet.rows.filter((row) => !row.objective);

  if (subjectiveRows.length === 0 && attempt.status !== "GRADED") {
    throw new Error("لا توجد أسئلة كتابية لتصحيحها في هذه المحاولة.");
  }

  const updates = subjectiveRows.map((row) => {
    const rawScore = formData.get(`score.${row.questionId}`);
    const rawFeedback = formData.get(`feedback.${row.questionId}`);
    const parsed =
      typeof rawScore === "string" && rawScore.trim() !== ""
        ? Number(rawScore.replace(",", "."))
        : Number.NaN;

    if (Number.isNaN(parsed)) {
      throw new Error(`أدخل درجة السؤال ${row.position} ثم حاول مرة أخرى.`);
    }

    if (parsed < 0 || parsed > row.maxScore) {
      throw new Error(`درجة السؤال ${row.position} يجب أن تكون بين 0 و ${row.maxScore}.`);
    }

    const feedback = typeof rawFeedback === "string" ? rawFeedback.trim().slice(0, 2000) : "";

    return {
      questionId: row.questionId,
      score: clampScore(parsed, row.maxScore),
      feedback,
    };
  });

  const savedAt = new Date();
  const finalScore =
    sheet.rows.reduce((sum, row) => (row.objective ? sum + (row.awardedScore ?? 0) : sum), 0) +
    updates.reduce((sum, update) => sum + update.score, 0);

  await prisma.$transaction(async (tx) => {
    for (const update of updates) {
      await tx.examAnswer.upsert({
        where: {
          attemptId_questionId: { attemptId, questionId: update.questionId },
        },
        create: {
          attemptId,
          questionId: update.questionId,
          answer: null,
          score: update.score,
          isCorrect: null,
          feedback: update.feedback || null,
        },
        update: {
          score: update.score,
          isCorrect: null,
          feedback: update.feedback || null,
        },
      });
    }

    await tx.examAttempt.update({
      where: { id: attemptId },
      data: { status: "GRADED", score: finalScore, feedback: null },
    });

    await tx.auditLog.create({
      data: {
        userId: actor.userId,
        action: "exam.attempt.grade",
        entity: "ExamAttempt",
        entityId: attemptId,
        metadata: {
          examId: sheet.examId,
          studentName: sheet.studentName,
          score: finalScore,
          totalScore: sheet.totalScore,
          gradedQuestions: updates.length,
        },
      },
    });
  });

  const studentUserId = await prisma.examAttempt
    .findUnique({ where: { id: attemptId }, select: { student: { select: { userId: true } } } })
    .then((row) => row?.student.userId ?? null)
    .catch(() => null);

  if (studentUserId) {
    await notifyUsers([studentUserId], {
      title: "تم تصحيح امتحانك",
      content: `تم تصحيح امتحان "${sheet.examTitle ?? "الامتحان"}" بدرجة ${finalScore} من ${sheet.totalScore}.`,
      link: `/student/exams/${sheet.examId}/result`,
    });
  }

  return {
    score: finalScore,
    totalScore: sheet.totalScore,
    percentage: percentOf(finalScore, sheet.totalScore),
    gradedQuestions: updates.length,
    attemptStatus: "GRADED",
    savedAt,
  };
}
