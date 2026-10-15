import { AttemptStatus, DifficultyLevel, QuestionType } from "@prisma/client";

import { percentOf } from "@/lib/format";
import { prisma } from "@/lib/prisma";

export type StudentExamState =
  | "UPCOMING"
  | "OPEN"
  | "IN_PROGRESS"
  | "EXPIRED"
  | "SUBMITTED"
  | "GRADED"
  | "CLOSED";

export const studentExamStateLabels: Record<StudentExamState, string> = {
  UPCOMING: "لم يبدأ بعد",
  OPEN: "متاح الآن",
  IN_PROGRESS: "قيد الإجابة",
  EXPIRED: "انتهى الوقت",
  SUBMITTED: "بانتظار التصحيح",
  GRADED: "تم التصحيح",
  CLOSED: "مغلق",
};

export function isObjectiveQuestion(type: QuestionType) {
  return type === "MULTIPLE_CHOICE" || type === "TRUE_FALSE";
}

export function attemptDeadline(startedAt: Date, durationMin: number, examEndsAt: Date) {
  const byDuration = new Date(startedAt.getTime() + durationMin * 60_000);
  return byDuration.getTime() <= examEndsAt.getTime() ? byDuration : examEndsAt;
}

export function remainingSeconds(deadline: Date, now = new Date()) {
  return Math.max(0, Math.floor((deadline.getTime() - now.getTime()) / 1000));
}

export function formatCountdown(totalSeconds: number) {
  const safe = Math.max(0, totalSeconds);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;

  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function normalizeAnswer(value: string) {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .toLowerCase();
}

type StateInput = {
  status: string;
  startsAt: Date;
  endsAt: Date;
  durationMin: number;
  attempt: { status: AttemptStatus; startedAt: Date } | null;
  now: Date;
};

export function resolveStudentExamState({
  status,
  startsAt,
  endsAt,
  durationMin,
  attempt,
  now,
}: StateInput): StudentExamState {
  if (attempt?.status === "GRADED") return "GRADED";
  if (attempt?.status === "SUBMITTED") return "SUBMITTED";

  if (attempt?.status === "IN_PROGRESS") {
    const deadline = attemptDeadline(attempt.startedAt, durationMin, endsAt);
    return now.getTime() <= deadline.getTime() ? "IN_PROGRESS" : "EXPIRED";
  }

  if (status !== "PUBLISHED") return "CLOSED";
  if (now.getTime() < startsAt.getTime()) return "UPCOMING";
  if (now.getTime() > endsAt.getTime()) return "CLOSED";
  return "OPEN";
}

export const studentExamStateTones: Record<
  StudentExamState,
  "success" | "warning" | "danger" | "neutral" | "brand" | "blue" | "info" | "violet"
> = {
  UPCOMING: "info",
  OPEN: "success",
  IN_PROGRESS: "warning",
  EXPIRED: "danger",
  SUBMITTED: "violet",
  GRADED: "brand",
  CLOSED: "neutral",
};

export type StudentExamRow = {
  id: string;
  title: string;
  description: string | null;
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  professorName: string | null;
  startsAt: Date;
  endsAt: Date;
  durationMin: number;
  totalScore: number;
  questionsCount: number;
  state: StudentExamState;
  attemptId: string | null;
  attemptScore: number | null;
  submittedAt: Date | null;
  percentage: number | null;
};

export type StudentExamListResult = {
  rows: StudentExamRow[];
  total: number;
  openCount: number;
  inProgressCount: number;
  awaitingCount: number;
  gradedCount: number;
  averagePercentage: number | null;
  upcoming: StudentExamRow[];
  available: StudentExamRow[];
  history: StudentExamRow[];
};

const examListInclude = {
  subject: {
    select: {
      id: true,
      name: true,
      code: true,
      professors: {
        where: { isPrimary: true },
        take: 1,
        select: { professor: { select: { user: { select: { fullName: true } } } } },
      },
    },
  },
} as const;

function toRow(
  exam: {
    id: string;
    title: string;
    description: string | null;
    status: string;
    startsAt: Date;
    endsAt: Date;
    durationMin: number;
    totalScore: number;
    subject: {
      id: string;
      name: string;
      code: string;
      professors: { professor: { user: { fullName: string } } }[];
    };
    _count: { questions: number };
    attempts: {
      id: string;
      status: AttemptStatus;
      score: number | null;
      submittedAt: Date | null;
      startedAt: Date;
    }[];
  },
  now: Date,
): StudentExamRow {
  const attempt = exam.attempts[0] ?? null;

  return {
    id: exam.id,
    title: exam.title,
    description: exam.description,
    subjectId: exam.subject.id,
    subjectName: exam.subject.name,
    subjectCode: exam.subject.code,
    professorName: exam.subject.professors[0]?.professor.user.fullName ?? null,
    startsAt: exam.startsAt,
    endsAt: exam.endsAt,
    durationMin: exam.durationMin,
    totalScore: exam.totalScore,
    questionsCount: exam._count.questions,
    state: resolveStudentExamState({
      status: exam.status,
      startsAt: exam.startsAt,
      endsAt: exam.endsAt,
      durationMin: exam.durationMin,
      attempt,
      now,
    }),
    attemptId: attempt?.id ?? null,
    attemptScore: attempt?.score ?? null,
    submittedAt: attempt?.submittedAt ?? null,
    percentage: percentOf(attempt?.score ?? 0, exam.totalScore),
  };
}

export async function listStudentExams(studentId: string): Promise<StudentExamListResult> {
  const now = new Date();

  const exams = await prisma.exam.findMany({
    where: {
      status: { in: ["PUBLISHED", "CLOSED", "ARCHIVED"] },
      subject: { enrollments: { some: { studentId, status: "ACTIVE" } } },
    },
    orderBy: [{ startsAt: "desc" }],
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      startsAt: true,
      endsAt: true,
      durationMin: true,
      totalScore: true,
      subject: examListInclude.subject,
      _count: { select: { questions: true } },
      attempts: {
        where: { studentId },
        take: 1,
        select: { id: true, status: true, score: true, submittedAt: true, startedAt: true },
      },
    },
  });

  const rows = exams.map((exam) => toRow(exam, now));
  const graded = rows.filter((row) => row.state === "GRADED" && row.attemptScore !== null);

  return {
    rows,
    total: rows.length,
    openCount: rows.filter((row) => row.state === "OPEN").length,
    inProgressCount: rows.filter((row) => row.state === "IN_PROGRESS" || row.state === "EXPIRED").length,
    awaitingCount: rows.filter((row) => row.state === "SUBMITTED").length,
    gradedCount: graded.length,
    averagePercentage: percentOf(
      graded.reduce((sum, row) => sum + (row.attemptScore ?? 0), 0),
      graded.reduce((sum, row) => sum + row.totalScore, 0),
    ),
    upcoming: rows
      .filter((row) => row.state === "UPCOMING")
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()),
    available: rows.filter(
      (row) => row.state === "OPEN" || row.state === "IN_PROGRESS" || row.state === "EXPIRED",
    ),
    history: rows
      .filter((row) => row.state === "GRADED" || row.state === "SUBMITTED" || row.state === "CLOSED")
      .sort(
        (a, b) =>
          (b.submittedAt?.getTime() ?? b.startsAt.getTime()) -
          (a.submittedAt?.getTime() ?? a.startsAt.getTime()),
      ),
  };
}

export type StudentExamBriefing = {
  id: string;
  title: string;
  description: string | null;
  subjectName: string;
  subjectCode: string;
  professorName: string | null;
  startsAt: Date;
  endsAt: Date;
  durationMin: number;
  totalScore: number;
  questionsCount: number;
  objectiveCount: number;
  subjectiveCount: number;
  questionsScore: number;
  state: StudentExamState;
  attemptId: string | null;
  attemptStatus: AttemptStatus | null;
  attemptScore: number | null;
  submittedAt: Date | null;
  answeredCount: number;
  remainingSeconds: number | null;
  isOpenNow: boolean;
};

export async function getStudentExamBriefing(
  studentId: string,
  examId: string,
): Promise<StudentExamBriefing | null> {
  const now = new Date();

  const exam = await prisma.exam.findFirst({
    where: {
      id: examId,
      subject: { enrollments: { some: { studentId, status: "ACTIVE" } } },
    },
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
          name: true,
          code: true,
          professors: {
            where: { isPrimary: true },
            take: 1,
            select: { professor: { select: { user: { select: { fullName: true } } } } },
          },
        },
      },
      questions: {
        orderBy: { position: "asc" },
        select: { score: true, question: { select: { type: true } } },
      },
      attempts: {
        where: { studentId },
        take: 1,
        select: {
          id: true,
          status: true,
          score: true,
          submittedAt: true,
          startedAt: true,
          _count: { select: { answers: true } },
        },
      },
    },
  });

  if (!exam) return null;

  const attempt = exam.attempts[0] ?? null;
  const state = resolveStudentExamState({
    status: exam.status,
    startsAt: exam.startsAt,
    endsAt: exam.endsAt,
    durationMin: exam.durationMin,
    attempt,
    now,
  });

  const deadline = attempt
    ? attemptDeadline(attempt.startedAt, exam.durationMin, exam.endsAt)
    : null;

  return {
    id: exam.id,
    title: exam.title,
    description: exam.description,
    subjectName: exam.subject.name,
    subjectCode: exam.subject.code,
    professorName: exam.subject.professors[0]?.professor.user.fullName ?? null,
    startsAt: exam.startsAt,
    endsAt: exam.endsAt,
    durationMin: exam.durationMin,
    totalScore: exam.totalScore,
    questionsCount: exam.questions.length,
    objectiveCount: exam.questions.filter((item) => isObjectiveQuestion(item.question.type)).length,
    subjectiveCount: exam.questions.filter((item) => !isObjectiveQuestion(item.question.type)).length,
    questionsScore: exam.questions.reduce((sum, item) => sum + item.score, 0),
    state,
    attemptId: attempt?.id ?? null,
    attemptStatus: attempt?.status ?? null,
    attemptScore: attempt?.score ?? null,
    submittedAt: attempt?.submittedAt ?? null,
    answeredCount: attempt?._count.answers ?? 0,
    remainingSeconds: deadline && attempt?.status === "IN_PROGRESS" ? remainingSeconds(deadline, now) : null,
    isOpenNow: state === "OPEN",
  };
}

export async function startStudentAttempt(studentId: string, userId: string, examId: string) {
  const now = new Date();

  const exam = await prisma.exam.findFirst({
    where: {
      id: examId,
      subject: { enrollments: { some: { studentId, status: "ACTIVE" } } },
    },
    select: {
      id: true,
      title: true,
      status: true,
      startsAt: true,
      endsAt: true,
      _count: { select: { questions: true } },
      attempts: { where: { studentId }, take: 1, select: { id: true, status: true } },
    },
  });

  if (!exam) throw new Error("هذا الامتحان غير متاح لحسابك.");
  if (exam.status !== "PUBLISHED") throw new Error("الامتحان غير منشور حالياً.");
  if (now.getTime() < exam.startsAt.getTime()) throw new Error("لم يبدأ وقت الامتحان بعد.");
  if (now.getTime() > exam.endsAt.getTime()) throw new Error("انتهى وقت الامتحان المحدد.");
  if (exam._count.questions === 0) throw new Error("لا توجد أسئلة في هذا الامتحان.");
  if (exam.attempts[0]) {
    return { attemptId: exam.attempts[0].id, alreadyStarted: true };
  }

  const attempt = await prisma.examAttempt.create({
    data: { examId: exam.id, studentId, status: "IN_PROGRESS", startedAt: now },
    select: { id: true },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: "exam.attempt.start",
      entity: "ExamAttempt",
      entityId: attempt.id,
      metadata: { examId: exam.id, examTitle: exam.title },
    },
  });

  return { attemptId: attempt.id, alreadyStarted: false };
}

export type AttemptQuestionView = {
  questionId: string;
  position: number;
  score: number;
  text: string;
  type: QuestionType;
  difficulty: DifficultyLevel;
  unit: string | null;
  chapter: string | null;
  options: { id: string; text: string }[];
  answer: string | null;
};

export type StudentAttemptView = {
  attemptId: string;
  examId: string;
  title: string;
  subjectName: string;
  subjectCode: string;
  totalScore: number;
  durationMin: number;
  questions: AttemptQuestionView[];
  answeredCount: number;
  totalQuestions: number;
  remainingSeconds: number;
  deadline: Date;
  isTimeUp: boolean;
};

async function loadAttempt(attemptId: string) {
  return prisma.examAttempt.findUnique({
    where: { id: attemptId },
    select: {
      id: true,
      studentId: true,
      status: true,
      startedAt: true,
      submittedAt: true,
      score: true,
      exam: {
        select: {
          id: true,
          title: true,
          status: true,
          startsAt: true,
          endsAt: true,
          durationMin: true,
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
                  difficulty: true,
                  unit: true,
                  chapter: true,
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
    },
  });
}

export async function getStudentAttemptForAnswering(
  studentId: string,
  attemptId: string,
): Promise<StudentAttemptView | null> {
  const attempt = await loadAttempt(attemptId);
  if (!attempt) return null;
  if (attempt.studentId !== studentId) return null;

  const answers = await prisma.examAnswer.findMany({
    where: { attemptId },
    select: { questionId: true, answer: true },
  });

  const deadline = attemptDeadline(attempt.startedAt, attempt.exam.durationMin, attempt.exam.endsAt);
  const answerMap = new Map(answers.map((row) => [row.questionId, row.answer]));
  const remaining = remainingSeconds(deadline);

  const questions: AttemptQuestionView[] = attempt.exam.questions.map((item) => ({
    questionId: item.question.id,
    position: item.position,
    score: item.score,
    text: item.question.text,
    type: item.question.type,
    difficulty: item.question.difficulty,
    unit: item.question.unit,
    chapter: item.question.chapter,
    options: item.question.options.map((option) => ({ id: option.id, text: option.text })),
    answer: answerMap.get(item.question.id) ?? null,
  }));

  return {
    attemptId: attempt.id,
    examId: attempt.exam.id,
    title: attempt.exam.title,
    subjectName: attempt.exam.subject.name,
    subjectCode: attempt.exam.subject.code,
    totalScore: attempt.exam.totalScore,
    durationMin: attempt.exam.durationMin,
    questions,
    answeredCount: questions.filter((question) => question.answer?.trim()).length,
    totalQuestions: questions.length,
    remainingSeconds: remaining,
    deadline,
    isTimeUp: remaining === 0,
  };
}

export async function getStudentAttemptForExam(studentId: string, examId: string) {
  return prisma.examAttempt.findFirst({
    where: { studentId, examId },
    select: { id: true, status: true, submittedAt: true, score: true },
  });
}

type GradingQuestion = {
  position: number;
  score: number;
  question: {
    id: string;
    type: QuestionType;
    options: { text: string; isCorrect: boolean }[];
  };
};

export type AnswerPayload = { questionId: string; answer: string | null }[];

export function readAnswerPayload(questions: GradingQuestion[], formData: FormData): AnswerPayload {
  return questions.map(({ question }) => {
    const raw = formData.get(`answer.${question.id}`);
    const value = typeof raw === "string" ? raw.trim().slice(0, 4000) : "";

    if (!value) return { questionId: question.id, answer: null };

    if (isObjectiveQuestion(question.type)) {
      const allowed = question.options.some(
        (option) => normalizeAnswer(option.text) === normalizeAnswer(value),
      );
      if (!allowed) return { questionId: question.id, answer: null };
    }

    return { questionId: question.id, answer: value };
  });
}

function gradeAnswer(
  question: GradingQuestion,
  answer: string | null,
): { score: number; isCorrect: boolean | null } {
  if (!isObjectiveQuestion(question.question.type)) return { score: 0, isCorrect: null };

  const correctText = question.question.options.find((option) => option.isCorrect)?.text ?? null;
  if (!answer || !correctText) return { score: 0, isCorrect: false };

  const isCorrect = normalizeAnswer(answer) === normalizeAnswer(correctText);
  return { score: isCorrect ? question.score : 0, isCorrect };
}

export type SubmitResult = {
  attemptId: string;
  status: AttemptStatus;
  score: number;
  totalScore: number;
  percentage: number | null;
  autoGradedCount: number;
  pendingReviewCount: number;
  alreadySubmitted: boolean;
};

export async function saveStudentAnswers(studentId: string, attemptId: string, formData: FormData) {
  const attempt = await loadAttempt(attemptId);
  if (!attempt) throw new Error("محاولة غير موجودة.");
  if (attempt.studentId !== studentId) throw new Error("لا تملك صلاحية تعديل هذه المحاولة.");

  const deadline = attemptDeadline(attempt.startedAt, attempt.exam.durationMin, attempt.exam.endsAt);
  if (attempt.status !== "IN_PROGRESS") throw new Error("تم تسليم الإجابات بالفعل.");
  if (new Date().getTime() > deadline.getTime()) {
    throw new Error("انتهى وقت الامتحان. سيتم تسليم إجاباتك المحفوظة.");
  }

  const payload = readAnswerPayload(attempt.exam.questions, formData);
  const filled = payload.filter((item) => item.answer !== null);

  await prisma.$transaction(async (tx) => {
    for (const item of filled) {
      await tx.examAnswer.upsert({
        where: { attemptId_questionId: { attemptId, questionId: item.questionId } },
        create: { attemptId, questionId: item.questionId, answer: item.answer },
        update: { answer: item.answer },
      });
    }

    const emptyIds = payload
      .filter((item) => item.answer === null)
      .map((item) => item.questionId);

    if (emptyIds.length > 0) {
      await tx.examAnswer.deleteMany({ where: { attemptId, questionId: { in: emptyIds } } });
    }
  });

  return { savedAt: new Date(), answeredCount: filled.length };
}

export async function submitStudentAttempt(
  studentId: string,
  userId: string,
  attemptId: string,
  formData: FormData | null,
): Promise<SubmitResult> {
  const attempt = await loadAttempt(attemptId);
  if (!attempt) throw new Error("محاولة غير موجودة.");
  if (attempt.studentId !== studentId) throw new Error("لا تملك صلاحية تسليم هذه المحاولة.");

  const exam = attempt.exam;

  if (attempt.status !== "IN_PROGRESS") {
    return {
      attemptId,
      status: attempt.status,
      score: attempt.score ?? 0,
      totalScore: exam.totalScore,
      percentage: percentOf(attempt.score ?? 0, exam.totalScore),
      autoGradedCount: 0,
      pendingReviewCount: 0,
      alreadySubmitted: true,
    };
  }

  const finalAnswers = formData
    ? readAnswerPayload(exam.questions, formData)
    : await loadStoredAnswers(attemptId, exam.questions);

  const graded = exam.questions.map((item) => {
    const entry = finalAnswers.find((value) => value.questionId === item.question.id);
    return { item, ...gradeAnswer(item, entry?.answer ?? null) };
  });

  const autoGraded = graded.filter((entry) => entry.isCorrect !== null);
  const pending = graded.filter((entry) => entry.isCorrect === null);
  const score = graded.reduce((sum, entry) => sum + entry.score, 0);
  const status: AttemptStatus = pending.length > 0 ? "SUBMITTED" : "GRADED";
  const submittedAt = new Date();

  await prisma.$transaction(async (tx) => {
    for (const entry of finalAnswers) {
      if (entry.answer === null) {
        await tx.examAnswer.deleteMany({
          where: { attemptId, questionId: entry.questionId },
        });
        continue;
      }

      const result = graded.find((value) => value.item.question.id === entry.questionId);
      const objective = isObjectiveQuestion(result?.item.question.type ?? "ESSAY");

      await tx.examAnswer.upsert({
        where: { attemptId_questionId: { attemptId, questionId: entry.questionId } },
        create: {
          attemptId,
          questionId: entry.questionId,
          answer: entry.answer,
          score: objective ? (result?.score ?? 0) : null,
          isCorrect: objective ? (result?.isCorrect ?? false) : null,
        },
        update: {
          answer: entry.answer,
          score: objective ? (result?.score ?? 0) : null,
          isCorrect: objective ? (result?.isCorrect ?? false) : null,
        },
      });
    }

    await tx.examAttempt.update({
      where: { id: attemptId },
      data: { status, score, submittedAt },
    });

    await tx.auditLog.create({
      data: {
        userId,
        action: "exam.attempt.submit",
        entity: "ExamAttempt",
        entityId: attemptId,
        metadata: {
          examId: exam.id,
          status,
          score,
          autoGraded: autoGraded.length,
          pendingReview: pending.length,
        },
      },
    });
  });

  return {
    attemptId,
    status,
    score,
    totalScore: exam.totalScore,
    percentage: percentOf(score, exam.totalScore),
    autoGradedCount: autoGraded.length,
    pendingReviewCount: pending.length,
    alreadySubmitted: false,
  };
}

async function loadStoredAnswers(attemptId: string, questions: GradingQuestion[]): Promise<AnswerPayload> {
  const saved = await prisma.examAnswer.findMany({
    where: { attemptId },
    select: { questionId: true, answer: true },
  });

  const stored = new Map(saved.map((row) => [row.questionId, row.answer]));

  return questions.map((item) => ({
    questionId: item.question.id,
    answer: stored.get(item.question.id) ?? null,
  }));
}

export type AttemptReviewRow = {
  questionId: string;
  position: number;
  text: string;
  type: QuestionType;
  maxScore: number;
  options: { id: string; text: string; isCorrect: boolean }[];
  studentAnswer: string | null;
  awardedScore: number | null;
  isCorrect: boolean | null;
  correctOptionText: string | null;
  modelAnswer: string | null;
  explanation: string | null;
  feedback: string | null;
};

export type StudentAttemptResult = {
  attemptId: string;
  examId: string;
  title: string;
  subjectName: string;
  subjectCode: string;
  totalScore: number;
  status: AttemptStatus;
  score: number;
  percentage: number | null;
  startedAt: Date;
  submittedAt: Date | null;
  usedMinutes: number | null;
  revealAnswers: boolean;
  summary: {
    correct: number;
    wrong: number;
    pending: number;
    earned: number;
    possible: number;
  };
  rows: AttemptReviewRow[];
};

export async function getStudentAttemptResult(
  studentId: string,
  attemptId: string,
): Promise<StudentAttemptResult | null> {
  const attempt = await prisma.examAttempt.findUnique({
    where: { id: attemptId },
    select: {
      id: true,
      status: true,
      score: true,
      startedAt: true,
      submittedAt: true,
      studentId: true,
      exam: {
        select: {
          id: true,
          title: true,
          totalScore: true,
          durationMin: true,
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
                  options: { orderBy: { position: "asc" }, select: { id: true, text: true, isCorrect: true } },
                },
              },
            },
          },
        },
      },
      answers: { select: { questionId: true, answer: true, score: true, isCorrect: true, feedback: true } },
    },
  });

  if (!attempt) return null;
  if (attempt.studentId !== studentId) return null;

  const exam = attempt.exam;
  const answers = new Map(attempt.answers.map((row) => [row.questionId, row]));
  const revealAnswers = attempt.status === "GRADED";

  const rows: AttemptReviewRow[] = exam.questions.map((item) => {
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
      correctOptionText: item.question.options.find((option) => option.isCorrect)?.text ?? null,
      modelAnswer: item.question.correctAnswer,
      explanation: item.question.explanation,
      feedback: answer?.feedback ?? null,
    };
  });

  const usedMinutes = attempt.submittedAt
    ? Math.max(1, Math.round((attempt.submittedAt.getTime() - attempt.startedAt.getTime()) / 60_000))
    : null;

  return {
    attemptId: attempt.id,
    examId: exam.id,
    title: exam.title,
    subjectName: exam.subject.name,
    subjectCode: exam.subject.code,
    totalScore: exam.totalScore,
    status: attempt.status,
    score: attempt.score ?? 0,
    percentage: percentOf(attempt.score ?? 0, exam.totalScore),
    startedAt: attempt.startedAt,
    submittedAt: attempt.submittedAt,
    usedMinutes,
    revealAnswers,
    summary: {
      correct: rows.filter((row) => row.isCorrect === true).length,
      wrong: rows.filter((row) => row.isCorrect === false).length,
      pending: rows.filter((row) => !isObjectiveQuestion(row.type)).length,
      earned: rows.reduce((sum, row) => sum + (row.awardedScore ?? 0), 0),
      possible: rows.reduce((sum, row) => sum + row.maxScore, 0),
    },
    rows,
  };
}
