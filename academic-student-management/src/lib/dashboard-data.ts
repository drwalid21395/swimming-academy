import { AttendanceStatus } from "@prisma/client";

import { percentOf } from "@/lib/format";
import { prisma } from "@/lib/prisma";

export type QueryResult<T> = { ok: true; data: T } | { ok: false; message: string };

export const databaseErrorMessage =
  "تعذر الاتصال بقاعدة البيانات. تأكد من تشغيل PostgreSQL وصحة بيانات الاتصال في ملف البيئة.";

async function run<T>(query: () => Promise<T>, message = databaseErrorMessage): Promise<QueryResult<T>> {
  try {
    return { ok: true, data: await query() };
  } catch (error) {
    console.error("[dashboard]", error);
    return { ok: false, message };
  }
}

export type AttendanceSummary = {
  present: number;
  absent: number;
  excused: number;
  total: number;
  percentage: number | null;
};

export function summarizeAttendance(statuses: AttendanceStatus[]): AttendanceSummary {
  const present = statuses.filter((status) => status === "PRESENT").length;
  const absent = statuses.filter((status) => status === "ABSENT").length;
  const excused = statuses.filter((status) => status === "EXCUSED").length;
  const total = present + absent;

  return { present, absent, excused, total, percentage: percentOf(present, total) };
}

export function summarizeAttendanceCounts(
  rows: { status: AttendanceStatus; count: number }[],
): AttendanceSummary {
  let present = 0;
  let absent = 0;
  let excused = 0;

  for (const row of rows) {
    if (row.status === "PRESENT") present += row.count;
    else if (row.status === "ABSENT") absent += row.count;
    else excused += row.count;
  }

  const total = present + absent;
  return { present, absent, excused, total, percentage: percentOf(present, total) };
}

function expandAttendanceCounts(rows: { status: AttendanceStatus; _count: { _all: number } }[]) {
  return rows.flatMap((row) => Array<AttendanceStatus>(row._count._all).fill(row.status));
}

export type AdminOverview = {
  studentsCount: number;
  subjectsCount: number;
  professorsCount: number;
  attendance: AttendanceSummary;
  examsAverage: number | null;
  gradedAttempts: number;
  activity: {
    id: string;
    action: string;
    entity: string;
    createdAt: Date;
    userName: string | null;
  }[];
  subjectsOverview: { id: string; name: string; students: number; attendance: number | null }[];
};

export async function getAdminOverview(): Promise<QueryResult<AdminOverview>> {
  return run(async () => {
    const [studentsCount, subjectsCount, professorsCount, attendanceRows, gradedAttempts, activity, subjects] =
      await Promise.all([
        prisma.student.count(),
        prisma.subject.count(),
        prisma.professor.count(),
        prisma.attendanceRecord.groupBy({ by: ["status"], _count: { _all: true } }),
        prisma.examAttempt.findMany({
          where: { status: "GRADED", score: { not: null } },
          select: { score: true, exam: { select: { totalScore: true } } },
          take: 2000,
        }),
        prisma.auditLog.findMany({
          orderBy: { createdAt: "desc" },
          take: 8,
          select: {
            id: true,
            action: true,
            entity: true,
            createdAt: true,
            user: { select: { fullName: true } },
          },
        }),
        prisma.subject.findMany({
          select: {
            id: true,
            name: true,
            enrollments: { where: { status: "ACTIVE" }, select: { id: true } },
            attendance: { select: { records: { select: { status: true } } } },
          },
          take: 6,
          orderBy: { name: "asc" },
        }),
      ]);

    const attendance = summarizeAttendance(expandAttendanceCounts(attendanceRows));
    const totalScore = gradedAttempts.reduce((sum, row) => sum + row.exam.totalScore, 0);
    const earnedScore = gradedAttempts.reduce((sum, row) => sum + (row.score ?? 0), 0);

    return {
      studentsCount,
      subjectsCount,
      professorsCount,
      attendance,
      examsAverage: percentOf(earnedScore, totalScore),
      gradedAttempts: gradedAttempts.length,
      activity: activity.map((row) => ({
        id: row.id,
        action: row.action,
        entity: row.entity,
        createdAt: row.createdAt,
        userName: row.user?.fullName ?? null,
      })),
      subjectsOverview: subjects.map((subject) => ({
        id: subject.id,
        name: subject.name,
        students: subject.enrollments.length,
        attendance: summarizeAttendance(
          subject.attendance.flatMap((session) => session.records.map((record) => record.status)),
        ).percentage,
      })),
    };
  });
}

export type ProfessorSubjectCard = {
  id: string;
  name: string;
  code: string;
  students: number;
  attendance: AttendanceSummary;
  attendanceLimit: number;
  questions: number;
};

export type ProfessorOverview = {
  fullName: string;
  subjects: ProfessorSubjectCard[];
  upcomingExams: { id: string; title: string; startsAt: Date; subjectName: string }[];
  recentAnnouncements: { id: string; title: string; createdAt: Date; subjectName: string }[];
  needsAttention: { studentName: string; universityId: string; subjectName: string; percentage: number }[];
};

export async function getProfessorOverview(userId: string): Promise<QueryResult<ProfessorOverview>> {
  return run(async () => {
    const professor = await prisma.professor.findUnique({
      where: { userId },
      select: {
        user: { select: { fullName: true } },
        subjects: {
          select: {
            subject: {
              select: {
                id: true,
                name: true,
                code: true,
                attendanceLimit: true,
                enrollments: { where: { status: "ACTIVE" }, select: { studentId: true } },
                questions: { select: { id: true } },
                exams: {
                  where: { status: "PUBLISHED", startsAt: { gte: new Date() } },
                  orderBy: { startsAt: "asc" },
                  take: 3,
                  select: { id: true, title: true, startsAt: true },
                },
                announcements: {
                  orderBy: { createdAt: "desc" },
                  take: 2,
                  select: { id: true, title: true, createdAt: true },
                },
                attendance: { select: { records: { select: { studentId: true, status: true } } } },
              },
            },
          },
        },
      },
    });

    if (!professor) {
      return {
        fullName: "",
        subjects: [],
        upcomingExams: [],
        recentAnnouncements: [],
        needsAttention: [],
      };
    }

    const subjectCards: ProfessorSubjectCard[] = [];
    const upcomingExams: ProfessorOverview["upcomingExams"] = [];
    const recentAnnouncements: ProfessorOverview["recentAnnouncements"] = [];
    const needsAttention: ProfessorOverview["needsAttention"] = [];

    for (const link of professor.subjects) {
      const subject = link.subject;
      const records = subject.attendance.flatMap((session) => session.records);
      const attendance = summarizeAttendance(records.map((record) => record.status));

      subjectCards.push({
        id: subject.id,
        name: subject.name,
        code: subject.code,
        students: subject.enrollments.length,
        attendance,
        attendanceLimit: subject.attendanceLimit,
        questions: subject.questions.length,
      });

      for (const exam of subject.exams) {
        upcomingExams.push({
          id: exam.id,
          title: exam.title,
          startsAt: exam.startsAt,
          subjectName: subject.name,
        });
      }

      for (const announcement of subject.announcements) {
        recentAnnouncements.push({
          id: announcement.id,
          title: announcement.title,
          createdAt: announcement.createdAt,
          subjectName: subject.name,
        });
      }

      const perStudent = new Map<string, AttendanceStatus[]>();
      for (const record of records) {
        perStudent.set(record.studentId, [...(perStudent.get(record.studentId) ?? []), record.status]);
      }

      const students = await prisma.student.findMany({
        where: { id: { in: [...perStudent.keys()] } },
        select: { id: true, universityId: true, user: { select: { fullName: true } } },
      });

      for (const student of students) {
        const summary = summarizeAttendance(perStudent.get(student.id) ?? []);
        if (summary.percentage !== null && summary.percentage < subject.attendanceLimit) {
          needsAttention.push({
            studentName: student.user.fullName,
            universityId: student.universityId,
            subjectName: subject.name,
            percentage: summary.percentage,
          });
        }
      }
    }

    upcomingExams.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    needsAttention.sort((a, b) => a.percentage - b.percentage);

    return {
      fullName: professor.user.fullName,
      subjects: subjectCards,
      upcomingExams: upcomingExams.slice(0, 5),
      recentAnnouncements: recentAnnouncements.slice(0, 5),
      needsAttention: needsAttention.slice(0, 6),
    };
  });
}

export type StudentSubjectCard = {
  id: string;
  name: string;
  code: string;
  professorName: string | null;
  attendance: AttendanceSummary;
  attendanceLimit: number;
  examsCount: number;
  averageScore: number | null;
};

export type StudentGrade = {
  attemptId: string;
  examTitle: string;
  subjectName: string;
  score: number | null;
  totalScore: number;
  percentage: number | null;
  submittedAt: Date | null;
};

export type StudentOverview = {
  fullName: string;
  universityId: string | null;
  departmentName: string | null;
  specializationName: string | null;
  academicYear: number | null;
  subjects: StudentSubjectCard[];
  grades: StudentGrade[];
  announcements: { id: string; title: string; createdAt: Date; subjectName: string }[];
  overallAverage: number | null;
};

export async function getStudentOverview(userId: string): Promise<QueryResult<StudentOverview>> {
  return run(async () => {
    const student = await prisma.student.findUnique({
      where: { userId },
      select: {
        id: true,
        universityId: true,
        academicYear: true,
        user: { select: { fullName: true } },
        department: { select: { name: true } },
        specialization: { select: { name: true } },
      },
    });

    if (!student) {
      return {
        fullName: "",
        universityId: null,
        departmentName: null,
        specializationName: null,
        academicYear: null,
        subjects: [],
        grades: [],
        announcements: [],
        overallAverage: null,
      };
    }

    const [enrollments, attempts] = await Promise.all([
      prisma.enrollment.findMany({
        where: { studentId: student.id, status: "ACTIVE" },
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
                select: { professor: { select: { user: { select: { fullName: true } } } } } },
              exams: {
                where: { status: { in: ["PUBLISHED", "CLOSED", "ARCHIVED"] } },
                select: { id: true },
              },
              attendance: {
                select: { records: { where: { studentId: student.id }, select: { status: true } } },
              },
              announcements: {
                orderBy: { createdAt: "desc" },
                take: 2,
                select: { id: true, title: true, createdAt: true },
              },
            },
          },
        },
      }),
      prisma.examAttempt.findMany({
        where: { studentId: student.id, status: "GRADED" },
        orderBy: { submittedAt: "desc" },
        select: {
          id: true,
          score: true,
          submittedAt: true,
          exam: { select: { title: true, totalScore: true, subjectId: true } },
        },
        take: 50,
      }),
    ]);

    const attemptsBySubject = new Map<string, (typeof attempts)[number][]>();
    for (const attempt of attempts) {
      attemptsBySubject.set(attempt.exam.subjectId, [
        ...(attemptsBySubject.get(attempt.exam.subjectId) ?? []),
        attempt,
      ]);
    }

    const subjectNames = new Map<string, string>();
    const subjects: StudentSubjectCard[] = [];
    const announcements: StudentOverview["announcements"] = [];

    for (const enrollment of enrollments) {
      const subject = enrollment.subject;
      subjectNames.set(subject.id, subject.name);

      const attendance = summarizeAttendance(
        subject.attendance.flatMap((session) => session.records.map((record) => record.status)),
      );
      const subjectAttempts = attemptsBySubject.get(subject.id) ?? [];
      const totalScore = subjectAttempts.reduce((sum, attempt) => sum + attempt.exam.totalScore, 0);
      const earnedScore = subjectAttempts.reduce((sum, attempt) => sum + (attempt.score ?? 0), 0);

      subjects.push({
        id: subject.id,
        name: subject.name,
        code: subject.code,
        professorName: subject.professors[0]?.professor.user.fullName ?? null,
        attendance,
        attendanceLimit: subject.attendanceLimit,
        examsCount: subject.exams.length,
        averageScore: percentOf(earnedScore, totalScore),
      });

      for (const announcement of subject.announcements) {
        announcements.push({
          id: announcement.id,
          title: announcement.title,
          createdAt: announcement.createdAt,
          subjectName: subject.name,
        });
      }
    }

    const grades: StudentGrade[] = attempts.map((attempt) => ({
      attemptId: attempt.id,
      examTitle: attempt.exam.title,
      subjectName: subjectNames.get(attempt.exam.subjectId) ?? "—",
      score: attempt.score,
      totalScore: attempt.exam.totalScore,
      percentage: percentOf(attempt.score ?? 0, attempt.exam.totalScore),
      submittedAt: attempt.submittedAt,
    }));

    const totalScore = attempts.reduce((sum, attempt) => sum + attempt.exam.totalScore, 0);
    const earnedScore = attempts.reduce((sum, attempt) => sum + (attempt.score ?? 0), 0);

    return {
      fullName: student.user.fullName,
      universityId: student.universityId,
      departmentName: student.department?.name ?? null,
      specializationName: student.specialization?.name ?? null,
      academicYear: student.academicYear,
      subjects,
      grades,
      announcements: announcements.slice(0, 5),
      overallAverage: percentOf(earnedScore, totalScore),
    };
  });
}
