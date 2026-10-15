import { prisma } from "@/lib/prisma";

export type StudentSubjectRow = {
  id: string;
  name: string;
  code: string;
  termName: string;
  departmentName: string;
  creditHours: number;
  attendanceLimit: number;
  professorName: string | null;
  sessionsCount: number;
  recordsCount: number;
  presentCount: number;
  absentCount: number;
  excusedCount: number;
  attendancePercentage: number | null;
  examsCount: number;
  gradedCount: number;
  pendingCount: number;
  averagePercentage: number | null;
};

export type StudentSubjectListResult = {
  rows: StudentSubjectRow[];
  totalSubjects: number;
  totalCredits: number;
  overallAttendance: number | null;
  lowAttendanceSubjects: number;
};

export async function listStudentSubjects(studentId: string): Promise<StudentSubjectListResult> {
  const enrollments = await prisma.enrollment.findMany({
    where: { studentId, status: "ACTIVE" },
    orderBy: { subject: { name: "asc" } },
    select: {
      status: true,
      subject: {
        select: {
          id: true,
          name: true,
          code: true,
          creditHours: true,
          attendanceLimit: true,
          academicTerm: { select: { name: true } },
          department: { select: { name: true } },
          professors: {
            where: { isPrimary: true },
            take: 1,
            select: { professor: { select: { user: { select: { fullName: true } } } } },
          },
          attendance: {
            select: { records: { where: { studentId }, select: { status: true } } },
          },
          exams: {
            select: {
              id: true,
              totalScore: true,
              attempts: { where: { studentId }, select: { score: true, status: true } },
            },
          },
        },
      },
    },
  });

  const rows: StudentSubjectRow[] = enrollments.map((enrollment) => {
    const subject = enrollment.subject;
    const records = subject.attendance.flatMap((session) => session.records);
    const presentCount = records.filter((record) => record.status === "PRESENT").length;
    const absentCount = records.filter((record) => record.status === "ABSENT").length;
    const excusedCount = records.filter((record) => record.status === "EXCUSED").length;
    const attendancePercentage =
      records.length === 0 ? null : (presentCount / records.length) * 100;

    const attempts = subject.exams.flatMap((exam) =>
      exam.attempts.map((attempt) => ({ score: attempt.score, total: exam.totalScore })),
    );
    const graded = attempts.filter((attempt) => attempt.score !== null);
    const earned = graded.reduce((sum, attempt) => sum + (attempt.score ?? 0), 0);
    const possible = graded.reduce((sum, attempt) => sum + attempt.total, 0);

    return {
      id: subject.id,
      name: subject.name,
      code: subject.code,
      termName: subject.academicTerm.name,
      departmentName: subject.department.name,
      creditHours: subject.creditHours,
      attendanceLimit: subject.attendanceLimit,
      professorName: subject.professors[0]?.professor.user.fullName ?? null,
      sessionsCount: subject.attendance.length,
      recordsCount: records.length,
      presentCount,
      absentCount,
      excusedCount,
      attendancePercentage,
      examsCount: subject.exams.length,
      gradedCount: graded.length,
      pendingCount: subject.exams.reduce(
        (sum, exam) => sum + exam.attempts.filter((attempt) => attempt.status === "SUBMITTED").length,
        0,
      ),
      averagePercentage: possible === 0 ? null : (earned / possible) * 100,
    };
  });

  const totalPresent = rows.reduce((sum, row) => sum + row.presentCount, 0);
  const totalRecords = rows.reduce((sum, row) => sum + row.recordsCount, 0);

  return {
    rows,
    totalSubjects: rows.length,
    totalCredits: rows.reduce((sum, row) => sum + row.creditHours, 0),
    overallAttendance: totalRecords === 0 ? null : (totalPresent / totalRecords) * 100,
    lowAttendanceSubjects: rows.filter(
      (row) =>
        row.attendancePercentage !== null && row.attendancePercentage < row.attendanceLimit,
    ).length,
  };
}

export type StudentAttendanceSubjectRow = {
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  attendanceLimit: number;
  sessionsCount: number;
  recordsCount: number;
  presentCount: number;
  absentCount: number;
  excusedCount: number;
  percentage: number | null;
  isLow: boolean;
  sessions: {
    id: string;
    date: Date;
    title: string | null;
    status: string | null;
    professorName: string;
  }[];
};

export type StudentAttendanceResult = {
  rows: StudentAttendanceSubjectRow[];
  totalSessions: number;
  overallPercentage: number | null;
  lowSubjects: number;
};

export async function listStudentAttendance(studentId: string): Promise<StudentAttendanceResult> {
  const enrollments = await prisma.enrollment.findMany({
    where: { studentId, status: "ACTIVE" },
    orderBy: { subject: { name: "asc" } },
    select: {
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
            orderBy: { date: "desc" },
            select: {
              id: true,
              date: true,
              title: true,
              createdBy: { select: { user: { select: { fullName: true } } } },
              records: { where: { studentId }, select: { status: true, reason: true } },
            },
          },
        },
      },
    },
  });

  const rows: StudentAttendanceSubjectRow[] = enrollments.map((enrollment) => {
    const subject = enrollment.subject;
    const records = subject.attendance.flatMap((session) => session.records);
    const presentCount = records.filter((record) => record.status === "PRESENT").length;
    const absentCount = records.filter((record) => record.status === "ABSENT").length;
    const excusedCount = records.filter((record) => record.status === "EXCUSED").length;
    const percentage = records.length === 0 ? null : (presentCount / records.length) * 100;

    return {
      subjectId: subject.id,
      subjectName: subject.name,
      subjectCode: subject.code,
      attendanceLimit: subject.attendanceLimit,
      sessionsCount: subject.attendance.length,
      recordsCount: records.length,
      presentCount,
      absentCount,
      excusedCount,
      percentage,
      isLow: percentage !== null && percentage < subject.attendanceLimit,
      sessions: subject.attendance.map((session) => ({
        id: session.id,
        date: session.date,
        title: session.title,
        status: session.records[0]?.status ?? null,
        professorName:
          subject.professors[0]?.professor.user.fullName ?? session.createdBy.user.fullName,
      })),
    };
  });

  const totalPresent = rows.reduce((sum, row) => sum + row.presentCount, 0);
  const totalRecords = rows.reduce((sum, row) => sum + row.recordsCount, 0);

  return {
    rows,
    totalSessions: rows.reduce((sum, row) => sum + row.sessionsCount, 0),
    overallPercentage: totalRecords === 0 ? null : (totalPresent / totalRecords) * 100,
    lowSubjects: rows.filter((row) => row.isLow).length,
  };
}

export type StudentGradeRow = {
  attemptId: string;
  examId: string;
  examTitle: string;
  subjectName: string;
  subjectCode: string;
  status: string;
  submittedAt: Date | null;
  score: number | null;
  totalScore: number;
  percentage: number | null;
  feedback: string | null;
  pendingReview: boolean;
};

export type StudentGradesResult = {
  rows: StudentGradeRow[];
  gradedCount: number;
  pendingCount: number;
  averagePercentage: number | null;
  bestPercentage: number | null;
  subjectsCount: number;
};

export async function listStudentGrades(studentId: string): Promise<StudentGradesResult> {
  const attempts = await prisma.examAttempt.findMany({
    where: { studentId },
    orderBy: [{ submittedAt: "desc" }, { startedAt: "desc" }],
    select: {
      id: true,
      status: true,
      score: true,
      feedback: true,
      submittedAt: true,
      exam: {
        select: {
          id: true,
          title: true,
          totalScore: true,
          subject: { select: { name: true, code: true } },
          questions: { select: { question: { select: { type: true } } } },
        },
      },
    },
  });

  const objectiveTypes = new Set(["MULTIPLE_CHOICE", "TRUE_FALSE"]);
  const rows: StudentGradeRow[] = attempts.map((attempt) => {
    const hasSubjective = attempt.exam.questions.some(
      (item) => !objectiveTypes.has(item.question.type),
    );
    const percentage =
      attempt.score === null ? null : (attempt.score / attempt.exam.totalScore) * 100;

    return {
      attemptId: attempt.id,
      examId: attempt.exam.id,
      examTitle: attempt.exam.title,
      subjectName: attempt.exam.subject.name,
      subjectCode: attempt.exam.subject.code,
      status: attempt.status,
      submittedAt: attempt.submittedAt,
      score: attempt.score,
      totalScore: attempt.exam.totalScore,
      percentage,
      feedback: attempt.feedback,
      pendingReview: attempt.status === "SUBMITTED" && hasSubjective,
    };
  });

  const graded = rows.filter((row) => row.percentage !== null);
  const average = graded.length
    ? graded.reduce((sum, row) => sum + (row.percentage ?? 0), 0) / graded.length
    : null;

  return {
    rows,
    gradedCount: graded.length,
    pendingCount: rows.filter((row) => row.status === "SUBMITTED").length,
    averagePercentage: average,
    bestPercentage: graded.length
      ? graded.reduce((max, row) => Math.max(max, row.percentage ?? 0), 0)
      : null,
    subjectsCount: new Set(rows.map((row) => row.subjectCode)).size,
  };
}

export type StudentNewsItem = {
  id: string;
  title: string;
  content: string;
  isPinned: boolean;
  publishedAt: Date | null;
  subjectName: string;
  subjectCode: string;
  authorName: string;
};

export async function listStudentNews(studentId: string): Promise<StudentNewsItem[]> {
  const now = new Date();

  const announcements = await prisma.announcement.findMany({
    where: {
      publishedAt: { not: null, lte: now },
      subject: { enrollments: { some: { studentId, status: "ACTIVE" } } },
    },
    orderBy: [{ isPinned: "desc" }, { publishedAt: "desc" }],
    take: 60,
    select: {
      id: true,
      title: true,
      content: true,
      isPinned: true,
      publishedAt: true,
      subject: { select: { name: true, code: true } },
      author: { select: { fullName: true } },
    },
  });

  return announcements.map((announcement) => ({
    id: announcement.id,
    title: announcement.title,
    content: announcement.content,
    isPinned: announcement.isPinned,
    publishedAt: announcement.publishedAt,
    subjectName: announcement.subject.name,
    subjectCode: announcement.subject.code,
    authorName: announcement.author.fullName,
  }));
}
