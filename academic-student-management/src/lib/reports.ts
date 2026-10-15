import { prisma } from "@/lib/prisma";
import { toCsv } from "@/lib/csv";

export type ReportFilters = {
  termId: string;
  subjectId: string;
};

export type ReportFiltersResult = {
  ok: true;
  data: { terms: ReportTermOption[]; subjects: ReportSubjectOption[] };
} | { ok: false; message: string };

export type ReportTermOption = { id: string; name: string; isCurrent: boolean };
export type ReportSubjectOption = { id: string; name: string; code: string };

export type SubjectComparisonRow = {
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  studentsCount: number;
  attendancePercentage: number;
  examsCount: number;
  gradedAttempts: number;
  averageScore: number | null;
  lowAttendanceCount: number;
};

export type GradeBucket = { label: string; count: number };

export type ReportSummary = {
  studentsCount: number;
  subjectsCount: number;
  attendancePercentage: number;
  averageScore: number | null;
  gradedAttempts: number;
  lowAttendanceCount: number;
};

function buildWhere(filters: ReportFilters) {
  const where: { academicTermId?: string; id?: string } = {};
  if (filters.termId) where.academicTermId = filters.termId;
  if (filters.subjectId) where.id = filters.subjectId;
  return where;
}

export async function listReportFilters(): Promise<ReportFiltersResult> {
  try {
    const [terms, subjects] = await Promise.all([
      prisma.academicTerm.findMany({
        orderBy: [{ isCurrent: "desc" }, { startDate: "desc" }],
        select: { id: true, name: true, isCurrent: true },
      }),
      prisma.subject.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true, code: true },
      }),
    ]);

    return { ok: true, data: { terms, subjects } };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "تعذر تحميل فلاتر التقرير." };
  }
}

async function loadSubjects(filters: ReportFilters) {
  return prisma.subject.findMany({
    where: buildWhere(filters),
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      code: true,
      attendanceLimit: true,
      _count: { select: { enrollments: { where: { status: "ACTIVE" } } } },
      enrollments: { where: { status: "ACTIVE" }, select: { studentId: true } },
      attendance: {
        select: { records: { select: { studentId: true, status: true } } },
      },
      exams: {
        select: {
          id: true,
          attempts: { where: { status: "GRADED" }, select: { score: true } },
        },
      },
    },
  });
}

export async function getSubjectComparison(filters: ReportFilters): Promise<SubjectComparisonRow[]> {
  const subjects = await loadSubjects(filters);

  return subjects.map((subject) => {
    const records = subject.attendance.flatMap((session) => session.records);
    const present = records.filter((record) => record.status === "PRESENT").length;
    const attendancePercentage = records.length === 0 ? 0 : (present / records.length) * 100;

    const attempts = subject.exams.flatMap((exam) => exam.attempts);
    const scored = attempts.filter((attempt) => attempt.score !== null);
    const averageScore =
      scored.length === 0
        ? null
        : scored.reduce((sum, attempt) => sum + (attempt.score ?? 0), 0) / scored.length;

    const byStudent = new Map<string, { total: number; present: number }>();
    for (const record of records) {
      const entry = byStudent.get(record.studentId) ?? { total: 0, present: 0 };
      entry.total += 1;
      if (record.status === "PRESENT") entry.present += 1;
      byStudent.set(record.studentId, entry);
    }

    const lowAttendanceCount = subject.enrollments.filter((enrollment) => {
      const own = byStudent.get(enrollment.studentId);
      if (!own || own.total === 0) return false;
      return (own.present / own.total) * 100 < subject.attendanceLimit;
    }).length;

    return {
      subjectId: subject.id,
      subjectName: subject.name,
      subjectCode: subject.code,
      studentsCount: subject._count.enrollments,
      attendancePercentage: Number(attendancePercentage.toFixed(1)),
      examsCount: subject.exams.length,
      gradedAttempts: scored.length,
      averageScore: averageScore === null ? null : Number(averageScore.toFixed(1)),
      lowAttendanceCount,
    };
  });
}

export function buildReportSummary(rows: SubjectComparisonRow[]): ReportSummary {
  const totalStudents = rows.reduce((sum, row) => sum + row.studentsCount, 0);
  const gradedAttempts = rows.reduce((sum, row) => sum + row.gradedAttempts, 0);
  const weightedAttendance =
    totalStudents === 0
      ? 0
      : rows.reduce((sum, row) => sum + row.attendancePercentage * row.studentsCount, 0) / totalStudents;

  const scoredRows = rows.filter((row) => row.averageScore !== null && row.gradedAttempts > 0);
  const scoredTotal = scoredRows.reduce((sum, row) => sum + row.gradedAttempts, 0);
  const averageScore =
    scoredTotal === 0
      ? null
      : Number(
          (
            scoredRows.reduce((sum, row) => sum + (row.averageScore ?? 0) * row.gradedAttempts, 0) / scoredTotal
          ).toFixed(1),
        );

  return {
    studentsCount: totalStudents,
    subjectsCount: rows.length,
    attendancePercentage: Number(weightedAttendance.toFixed(1)),
    averageScore,
    gradedAttempts,
    lowAttendanceCount: rows.reduce((sum, row) => sum + row.lowAttendanceCount, 0),
  } satisfies ReportSummary;
}

export async function getGradeDistribution(filters: ReportFilters): Promise<GradeBucket[]> {
  const subjects = await prisma.subject.findMany({
    where: buildWhere(filters),
    select: { exams: { select: { totalScore: true, attempts: { where: { status: "GRADED" }, select: { score: true } } } } },
  });

  const buckets: GradeBucket[] = [
    { label: "أقل من 50%", count: 0 },
    { label: "50% - 59%", count: 0 },
    { label: "60% - 69%", count: 0 },
    { label: "70% - 79%", count: 0 },
    { label: "80% - 89%", count: 0 },
    { label: "90% فأكثر", count: 0 },
  ];

  for (const subject of subjects) {
    for (const exam of subject.exams) {
      if (exam.totalScore <= 0) continue;

      for (const attempt of exam.attempts) {
        if (attempt.score === null) continue;
        const percent = (attempt.score / exam.totalScore) * 100;
        const index =
          percent < 50 ? 0 : percent < 60 ? 1 : percent < 70 ? 2 : percent < 80 ? 3 : percent < 90 ? 4 : 5;
        buckets[index].count += 1;
      }
    }
  }

  return buckets;
}

export function subjectComparisonCsv(rows: SubjectComparisonRow[]) {
  return toCsv(
    ["المادة", "الرمز", "الطلاب", "نسبة الحضور %", "الامتحانات", "المحاولات المصححة", "متوسط الدرجة", "طلاب أقل من حد الحضور"],
    rows.map((row) => [
      row.subjectName,
      row.subjectCode,
      row.studentsCount,
      row.attendancePercentage,
      row.examsCount,
      row.gradedAttempts,
      row.averageScore,
      row.lowAttendanceCount,
    ]),
  );
}
