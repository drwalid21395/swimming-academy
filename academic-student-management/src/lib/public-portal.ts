import type { QuestionType } from "@prisma/client";

import { prisma } from "@/lib/prisma";

/**
 * طبقة بيانات البوابة العامة.
 * لا تستخدم أي جلسة أو صلاحية: كلها قراءة فقط لحقول غير حساسة
 * (لا بريد/هاتف طلاب، ولا أسئلة أو إجابات أو محاولات).
 */

export const PUBLIC_DATA_RESULT = {
  ok: true,
} as const;

const publicSubjectSelect = {
  id: true,
  code: true,
  name: true,
  description: true,
  creditHours: true,
  department: { select: { id: true, name: true, code: true } },
  academicTerm: { select: { id: true, name: true, isCurrent: true } },
} as const;

const publicProfessorSelect = {
  id: true,
  employeeCode: true,
  department: { select: { id: true, name: true, code: true } },
  user: { select: { fullName: true } },
} as const;

export type PublicSubject = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  creditHours: number;
  department: { id: string; name: string; code: string };
  academicTerm: { id: string; name: string; isCurrent: boolean };
};

export type PublicProfessor = {
  id: string;
  fullName: string;
  employeeCode: string;
  department: { id: string; name: string; code: string };
};

export type PublicDepartment = {
  id: string;
  name: string;
  code: string;
  description: string | null;
  professorsCount: number;
  subjectsCount: number;
};

export type PublicSubjectWithProfessor = PublicSubject & {
  isPrimary: boolean;
  professor: PublicProfessor;
};

export type PublicExam = {
  id: string;
  title: string;
  description: string | null;
  startsAt: Date;
  endsAt: Date;
  durationMin: number;
  totalScore: number;
  questionsCount: number;
  isOpen: boolean;
};

export type PublicQuestionBank = {
  total: number;
  byType: { type: QuestionType; label: string; count: number }[];
  byDifficulty: { label: string; count: number }[];
  categories: { name: string; count: number }[];
};

export type PublicAnnouncement = {
  id: string;
  title: string;
  content: string;
  isPinned: boolean;
  publishedAt: Date;
  authorName: string;
};

export type PublicSubjectDetail = {
  subject: PublicSubject;
  professors: { professor: PublicProfessor; isPrimary: boolean }[];
  exams: PublicExam[];
  questionBank: PublicQuestionBank;
  announcements: PublicAnnouncement[];
  stats: { exams: number; questions: number; announcements: number };
};

export type PublicPracticeQuestion = {
  id: string;
  text: string;
  type: string;
  typeLabel: string;
  difficultyLabel: string;
  category: string | null;
  unit: string | null;
  chapter: string | null;
  correctAnswer: string | null;
  explanation: string | null;
  options: { id: string; text: string; isCorrect: boolean }[];
};

const typeLabels: Record<string, string> = {
  MULTIPLE_CHOICE: "اختيار من متعدد",
  TRUE_FALSE: "صواب وخطأ",
  SHORT_ANSWER: "سؤال مقالي",
  ESSAY: "سؤال تعبيري",
};

const difficultyLabels: Record<string, string> = {
  EASY: "سهل",
  MEDIUM: "متوسط",
  HARD: "صعب",
};

export async function listPublicDepartments(): Promise<PublicDepartment[]> {
  const departments = await prisma.department.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      code: true,
      description: true,
      _count: { select: { professors: true, subjects: true } },
    },
  });

  return departments.map((department) => ({
    id: department.id,
    name: department.name,
    code: department.code,
    description: department.description,
    professorsCount: department._count.professors,
    subjectsCount: department._count.subjects,
  }));
}

export async function getPublicDepartment(code: string) {
  return prisma.department.findUnique({
    where: { code },
    select: { id: true, name: true, code: true, description: true },
  });
}

export async function listPublicProfessors(departmentId: string): Promise<
  (PublicProfessor & { subjects: (PublicSubject & { isPrimary: boolean })[], subjectsCount: number })[]
> {
  const professors = await prisma.professor.findMany({
    where: { departmentId },
    orderBy: { user: { fullName: "asc" } },
    select: {
      ...publicProfessorSelect,
      subjects: {
        orderBy: { isPrimary: "desc" },
        select: { isPrimary: true, subject: { select: publicSubjectSelect } },
      },
    },
  });

  return professors.map((professor) => ({
    id: professor.id,
    fullName: professor.user.fullName,
    employeeCode: professor.employeeCode,
    department: professor.department,
    subjects: professor.subjects.map((link) => ({ ...link.subject, isPrimary: link.isPrimary })),
    subjectsCount: professor.subjects.length,
  }));
}

export async function getPublicProfessor(id: string) {
  const professor = await prisma.professor.findUnique({
    where: { id },
    select: {
      ...publicProfessorSelect,
      user: { select: { fullName: true } },
      subjects: {
        orderBy: [{ isPrimary: "desc" }, { subject: { name: "asc" } }],
        select: { isPrimary: true, subject: { select: publicSubjectSelect } },
      },
    },
  });

  if (!professor) return null;

  return {
    id: professor.id,
    fullName: professor.user.fullName,
    employeeCode: professor.employeeCode,
    department: professor.department,
    subjects: professor.subjects.map((link) => ({ ...link.subject, isPrimary: link.isPrimary })),
  };
}

export async function listPublicSubjects(options: { query?: string; departmentId?: string } = {}) {
  const query = options.query?.trim() ?? "";

  return prisma.subject.findMany({
    where: {
      ...(options.departmentId ? { departmentId: options.departmentId } : {}),
      ...(query
        ? {
            OR: [
              { name: { contains: query, mode: "insensitive" } },
              { code: { contains: query, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: [{ academicTerm: { isCurrent: "desc" } }, { name: "asc" }],
    take: 60,
    select: publicSubjectSelect,
  });
}

export async function getPublicSubjectExams(subjectId: string): Promise<PublicExam[]> {
  const now = new Date();
  const exams = await prisma.exam.findMany({
    where: { subjectId, status: "PUBLISHED" },
    orderBy: { startsAt: "desc" },
    select: {
      id: true,
      title: true,
      description: true,
      startsAt: true,
      endsAt: true,
      durationMin: true,
      totalScore: true,
      _count: { select: { questions: true } },
    },
  });

  return exams.map((exam) => ({
    id: exam.id,
    title: exam.title,
    description: exam.description,
    startsAt: exam.startsAt,
    endsAt: exam.endsAt,
    durationMin: exam.durationMin,
    totalScore: exam.totalScore,
    questionsCount: exam._count.questions,
    isOpen: exam.startsAt.getTime() <= now.getTime() && now.getTime() <= exam.endsAt.getTime(),
  }));
}

export async function getPublicQuestionBank(subjectId: string): Promise<PublicQuestionBank> {
  const [total, byType, byDifficulty, categories] = await Promise.all([
    prisma.question.count({ where: { subjectId } }),
    prisma.question.groupBy({ by: ["type"], where: { subjectId }, _count: { _all: true } }),
    prisma.question.groupBy({ by: ["difficulty"], where: { subjectId }, _count: { _all: true } }),
    prisma.questionCategory.findMany({
      where: { subjectId },
      orderBy: { name: "asc" },
      select: { name: true, _count: { select: { questions: true } } },
    }),
  ]);

  return {
    total,
    byType: byType.map((row) => ({
      type: row.type,
      label: typeLabels[row.type] ?? row.type,
      count: row._count._all,
    })),
    byDifficulty: byDifficulty.map((row) => ({
      label: difficultyLabels[row.difficulty] ?? row.difficulty,
      count: row._count._all,
    })),
    categories: categories.map((row) => ({ name: row.name, count: row._count.questions })),
  };
}

export async function getPublicAnnouncements(subjectId: string): Promise<PublicAnnouncement[]> {
  const now = new Date();
  const announcements = await prisma.announcement.findMany({
    where: { subjectId, publishedAt: { not: null, lte: now } },
    orderBy: [{ isPinned: "desc" }, { publishedAt: "desc" }],
    take: 20,
    select: {
      id: true,
      title: true,
      content: true,
      isPinned: true,
      publishedAt: true,
      author: { select: { fullName: true } },
    },
  });

  return announcements.map((announcement) => ({
    id: announcement.id,
    title: announcement.title,
    content: announcement.content,
    isPinned: announcement.isPinned,
    publishedAt: announcement.publishedAt as Date,
    authorName: announcement.author.fullName,
  }));
}

export async function getPublicSubjectDetail(subjectId: string): Promise<PublicSubjectDetail | null> {
  const subject = await prisma.subject.findUnique({
    where: { id: subjectId },
    select: {
      ...publicSubjectSelect,
      professors: {
        orderBy: [{ isPrimary: "desc" }, { professor: { user: { fullName: "asc" } } }],
        select: { isPrimary: true, professor: { select: publicProfessorSelect } },
      },
    },
  });

  if (!subject) return null;

  const [exams, questionBank, announcements] = await Promise.all([
    getPublicSubjectExams(subjectId),
    getPublicQuestionBank(subjectId),
    getPublicAnnouncements(subjectId),
  ]);

  return {
    subject: {
      id: subject.id,
      code: subject.code,
      name: subject.name,
      description: subject.description,
      creditHours: subject.creditHours,
      department: subject.department,
      academicTerm: subject.academicTerm,
    },
    professors: subject.professors.map((link) => ({
      isPrimary: link.isPrimary,
      professor: {
        id: link.professor.id,
        fullName: link.professor.user.fullName,
        employeeCode: link.professor.employeeCode,
        department: link.professor.department,
      },
    })),
    exams,
    questionBank,
    announcements,
    stats: {
      exams: exams.length,
      questions: questionBank.total,
      announcements: announcements.length,
    },
  };
}

function sampleIds(items: string[], take: number): string[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, take);
}

function toPublicPracticeQuestion<T extends {
  id: string;
  text: string;
  type: QuestionType;
  difficulty: keyof typeof difficultyLabels;
  unit: string | null;
  chapter: string | null;
  correctAnswer: string | null;
  explanation: string | null;
  category: { name: string } | null;
  options: { id: string; text: string; isCorrect: boolean }[];
}>(row: T): PublicPracticeQuestion {
  return {
    id: row.id,
    text: row.text,
    type: row.type,
    typeLabel: typeLabels[row.type] ?? row.type,
    difficultyLabel: difficultyLabels[row.difficulty] ?? row.difficulty,
    category: row.category?.name ?? null,
    unit: row.unit,
    chapter: row.chapter,
    correctAnswer: row.correctAnswer,
    explanation: row.explanation,
    options: row.options,
  };
}

export async function getPublicPracticeQuestions(
  subjectId: string,
  take = 10,
): Promise<PublicPracticeQuestion[]> {
  const ids = await prisma.question.findMany({
    where: { subjectId },
    select: { id: true },
  });

  const sampled = sampleIds(ids.map((row) => row.id), Math.max(0, Math.min(take, ids.length)));
  if (sampled.length === 0) return [];

  const rows = await prisma.question.findMany({
    where: { id: { in: sampled } },
    select: {
      id: true,
      text: true,
      type: true,
      difficulty: true,
      unit: true,
      chapter: true,
      correctAnswer: true,
      explanation: true,
      category: { select: { name: true } },
      options: { orderBy: { position: "asc" }, select: { id: true, text: true, isCorrect: true } },
    },
  });

  return sampled.flatMap((id) => {
    const row = rows.find((item) => item.id === id);
    return row ? [toPublicPracticeQuestion(row)] : [];
  });
}

export async function listPublicBankQuestions(
  subjectId: string,
  options: { type?: QuestionType; limit?: number } = {},
): Promise<PublicPracticeQuestion[]> {
  const rows = await prisma.question.findMany({
    where: {
      subjectId,
      ...(options.type ? { type: options.type } : {}),
    },
    orderBy: [{ category: { name: "asc" } }, { unit: "asc" }, { text: "asc" }],
    take: Math.max(1, Math.min(options.limit ?? 300, 300)),
    select: {
      id: true,
      text: true,
      type: true,
      difficulty: true,
      unit: true,
      chapter: true,
      correctAnswer: true,
      explanation: true,
      category: { select: { name: true } },
      options: { orderBy: { position: "asc" }, select: { id: true, text: true, isCorrect: true } },
    },
  });

  return rows.map(toPublicPracticeQuestion);
}

export const publicQuestionTypes: QuestionType[] = [
  "MULTIPLE_CHOICE",
  "TRUE_FALSE",
  "SHORT_ANSWER",
  "ESSAY",
];

export async function buildPublicExam(
  subjectId: string,
  options: { allCount?: number; typeCounts?: Partial<Record<QuestionType, number>> } = {},
): Promise<PublicPracticeQuestion[]> {
  const rows = await prisma.question.findMany({
    where: { subjectId },
    orderBy: [{ category: { name: "asc" } }, { text: "asc" }],
    select: {
      id: true,
      text: true,
      type: true,
      difficulty: true,
      unit: true,
      chapter: true,
      correctAnswer: true,
      explanation: true,
      category: { select: { name: true } },
      options: { orderBy: { position: "asc" }, select: { id: true, text: true, isCorrect: true } },
    },
  });

  const pool = rows.map(toPublicPracticeQuestion);
  const byId = new Map(pool.map((question) => [question.id, question]));
  const picked: PublicPracticeQuestion[] = [];

  if (options.allCount && options.allCount > 0) {
    for (const id of sampleIds([...byId.keys()], byId.size).slice(0, options.allCount)) {
      picked.push(byId.get(id)!);
    }
  }

  const typeCounts = options.typeCounts ?? {};
  for (const [type, count] of Object.entries(typeCounts) as [QuestionType, number][]) {
    if (count > 0) {
      const typedIds = pool.filter((question) => question.type === type).map((question) => question.id);
      for (const id of sampleIds(typedIds, typedIds.length).slice(0, count)) {
        picked.push(byId.get(id)!);
      }
    }
  }

  return picked;
}
