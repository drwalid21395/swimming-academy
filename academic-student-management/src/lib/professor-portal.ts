import { prisma } from "@/lib/prisma";

export type ProfessorSubjectRow = {
  id: string;
  name: string;
  code: string;
  termName: string;
  departmentName: string;
  attendanceLimit: number;
  isPrimary: boolean;
  studentsCount: number;
  sessionsCount: number;
  examsCount: number;
  questionsCount: number;
  announcementsCount: number;
  nextSessionDate: Date | null;
};

export type ProfessorSubjectListResult = {
  rows: ProfessorSubjectRow[];
  totalSubjects: number;
  totalStudents: number;
  totalSessions: number;
  totalExams: number;
  primarySubjects: number;
};

export async function listProfessorSubjects(
  subjectIds: string[],
  professorId: string,
): Promise<ProfessorSubjectListResult> {
  if (subjectIds.length === 0) {
    return {
      rows: [],
      totalSubjects: 0,
      totalStudents: 0,
      totalSessions: 0,
      totalExams: 0,
      primarySubjects: 0,
    };
  }

  const subjects = await prisma.subject.findMany({
    where: { id: { in: subjectIds } },
    orderBy: [{ name: "asc" }],
    select: {
      id: true,
      name: true,
      code: true,
      attendanceLimit: true,
      academicTerm: { select: { name: true } },
      department: { select: { name: true } },
      professors: { where: { professorId }, select: { isPrimary: true } },
      enrollments: { where: { status: "ACTIVE" }, select: { studentId: true } },
      attendance: { select: { id: true, date: true } },
      exams: { select: { id: true } },
      questions: { select: { id: true } },
      announcements: { select: { id: true } },
    },
  });

  const now = new Date();
  const rows: ProfessorSubjectRow[] = subjects.map((subject) => {
    const upcoming = subject.attendance
      .filter((session) => session.date >= now)
      .sort((a, b) => a.date.getTime() - b.date.getTime());

    return {
      id: subject.id,
      name: subject.name,
      code: subject.code,
      termName: subject.academicTerm.name,
      departmentName: subject.department.name,
      attendanceLimit: subject.attendanceLimit,
      isPrimary: subject.professors[0]?.isPrimary ?? false,
      studentsCount: new Set(subject.enrollments.map((row) => row.studentId)).size,
      sessionsCount: subject.attendance.length,
      examsCount: subject.exams.length,
      questionsCount: subject.questions.length,
      announcementsCount: subject.announcements.length,
      nextSessionDate: upcoming[0]?.date ?? null,
    };
  });

  return {
    rows,
    totalSubjects: rows.length,
    totalStudents: rows.reduce((sum, row) => sum + row.studentsCount, 0),
    totalSessions: rows.reduce((sum, row) => sum + row.sessionsCount, 0),
    totalExams: rows.reduce((sum, row) => sum + row.examsCount, 0),
    primarySubjects: rows.filter((row) => row.isPrimary).length,
  };
}

export type ProfessorSubjectDetail = {
  id: string;
  name: string;
  code: string;
  description: string | null;
  termName: string;
  attendanceLimit: number;
  departmentName: string;
  isPrimary: boolean;
  studentsCount: number;
  sessionsCount: number;
  examsCount: number;
  questionsCount: number;
  announcementsCount: number;
  presentCount: number;
  totalRecords: number;
  recentSessions: {
    id: string;
    date: Date;
    title: string | null;
    markedCount: number;
    studentsCount: number;
    presentCount: number;
  }[];
  recentExams: {
    id: string;
    title: string;
    status: string;
    startsAt: Date;
    attemptsCount: number;
    pendingCount: number;
  }[];
};

export async function getProfessorSubjectDetail(
  subjectIds: string[],
  professorId: string,
  subjectId: string,
): Promise<ProfessorSubjectDetail | null> {
  if (!subjectIds.includes(subjectId)) return null;

  const subject = await prisma.subject.findFirst({
    where: { id: { in: subjectIds, equals: subjectId } },
    select: {
      id: true,
      name: true,
      code: true,
      description: true,
      attendanceLimit: true,
      academicTerm: { select: { name: true } },
      department: { select: { name: true } },
      professors: { where: { professorId }, select: { isPrimary: true } },
      enrollments: { where: { status: "ACTIVE" }, select: { studentId: true } },
      questions: { select: { id: true } },
      announcements: { select: { id: true } },
      attendance: {
        orderBy: { date: "desc" },
        take: 8,
        select: {
          id: true,
          date: true,
          title: true,
          records: { select: { status: true } },
        },
      },
      exams: {
        orderBy: { startsAt: "desc" },
        take: 6,
        select: {
          id: true,
          title: true,
          status: true,
          startsAt: true,
          attempts: { select: { status: true } },
        },
      },
      _count: { select: { attendance: true, exams: true } },
    },
  });

  if (!subject) return null;

  const allRecords = subject.attendance.flatMap((session) => session.records);
  const presentCount = allRecords.filter((record) => record.status === "PRESENT").length;
  const studentsCount = new Set(subject.enrollments.map((row) => row.studentId)).size;

  return {
    id: subject.id,
    name: subject.name,
    code: subject.code,
    description: subject.description,
    termName: subject.academicTerm.name,
    attendanceLimit: subject.attendanceLimit,
    departmentName: subject.department.name,
    isPrimary: subject.professors[0]?.isPrimary ?? false,
    studentsCount,
    sessionsCount: subject._count.attendance,
    examsCount: subject._count.exams,
    questionsCount: subject.questions.length,
    announcementsCount: subject.announcements.length,
    presentCount,
    totalRecords: allRecords.length,
    recentSessions: subject.attendance.map((session) => ({
      id: session.id,
      date: session.date,
      title: session.title,
      markedCount: session.records.length,
      studentsCount,
      presentCount: session.records.filter((record) => record.status === "PRESENT").length,
    })),
    recentExams: subject.exams.map((exam) => ({
      id: exam.id,
      title: exam.title,
      status: exam.status,
      startsAt: exam.startsAt,
      attemptsCount: exam.attempts.length,
      pendingCount: exam.attempts.filter((attempt) => attempt.status === "SUBMITTED").length,
    })),
  };
}

export type ProfessorStudentRow = {
  studentId: string;
  fullName: string;
  universityId: string;
  email: string;
  academicYear: number;
  departmentName: string;
  presentCount: number;
  absentCount: number;
  excusedCount: number;
  recordsCount: number;
  percentage: number | null;
  isLow: boolean;
};

export async function listProfessorSubjectStudents(
  subjectIds: string[],
  subjectId: string,
  attendanceLimit: number,
): Promise<ProfessorStudentRow[]> {
  if (!subjectIds.includes(subjectId)) return [];

  const enrollments = await prisma.enrollment.findMany({
    where: { subjectId, status: "ACTIVE" },
    orderBy: { student: { user: { fullName: "asc" } } },
    select: {
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
  });

  const studentIds = enrollments.map((row) => row.student.id);

  const records = studentIds.length
    ? await prisma.attendanceRecord.findMany({
        where: { session: { subjectId }, studentId: { in: studentIds } },
        select: { studentId: true, status: true },
      })
    : [];

  const byStudent = new Map<string, { present: number; absent: number; excused: number }>();
  for (const record of records) {
    const bucket = byStudent.get(record.studentId) ?? { present: 0, absent: 0, excused: 0 };
    if (record.status === "PRESENT") bucket.present += 1;
    else if (record.status === "ABSENT") bucket.absent += 1;
    else bucket.excused += 1;
    byStudent.set(record.studentId, bucket);
  }

  return enrollments.map((enrollment) => {
    const student = enrollment.student;
    const bucket = byStudent.get(student.id) ?? { present: 0, absent: 0, excused: 0 };
    const recordsCount = bucket.present + bucket.absent + bucket.excused;
    const percentage = recordsCount === 0 ? null : (bucket.present / recordsCount) * 100;

    return {
      studentId: student.id,
      fullName: student.user.fullName,
      universityId: student.universityId,
      email: student.user.email,
      academicYear: student.academicYear,
      departmentName: student.department.name,
      presentCount: bucket.present,
      absentCount: bucket.absent,
      excusedCount: bucket.excused,
      recordsCount,
      percentage,
      isLow: percentage !== null && percentage < attendanceLimit,
    };
  });
}
