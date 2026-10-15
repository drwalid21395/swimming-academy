const fs = require("node:fs");
const path = require("node:path");
const bcrypt = require("bcryptjs");
const {
  PrismaClient,
  UserRole,
  AttendanceStatus,
  ExamStatus,
  QuestionType,
  DifficultyLevel,
  AttemptStatus,
  EnrollmentStatus,
} = require("@prisma/client");

const prisma = new PrismaClient();

function loadEnvFile() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;

  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    const value = rawValue.trim().replace(/^"(.*)"$/, "$1");
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile();

const departments = [
  { name: "علوم الحاسب والمعلومات", code: "CS" },
  { name: "الهندسة", code: "ENG" },
  { name: "إدارة الأعمال", code: "BUS" },
];

const professors = [
  {
    fullName: "د. محمود عبد الرحمن",
    email: "prof.mahmoud@university.edu",
    employeeCode: "P-1001",
    departmentCode: "CS",
    permissions: [
      "SUBJECTS_MANAGE",
      "QUESTIONS_MANAGE",
      "EXAMS_MANAGE",
      "RESULTS_VIEW",
      "ANNOUNCEMENTS_PUBLISH",
    ],
  },
  {
    fullName: "د. هالة سامي فؤاد",
    email: "prof.hala@university.edu",
    employeeCode: "P-1002",
    departmentCode: "ENG",
    permissions: ["QUESTIONS_MANAGE", "EXAMS_MANAGE", "RESULTS_VIEW"],
  },
  {
    // No RESULTS_VIEW and no ANNOUNCEMENTS_PUBLISH on purpose, so the
    // permission system stays visible in the demo data.
    fullName: "د. طارق إبراهيم عيد",
    email: "prof.tarek@university.edu",
    employeeCode: "P-1003",
    departmentCode: "BUS",
    permissions: ["SUBJECTS_MANAGE", "ANNOUNCEMENTS_PUBLISH"],
  },
];

const subjects = [
  { code: "CS101", name: "مقدمة في البرمجة", departmentCode: "CS", professorCode: "P-1001" },
  { code: "CS102", name: "قواعد البيانات", departmentCode: "CS", professorCode: "P-1001" },
  { code: "CS103", name: "الخوارزميات وتحليل التعقيد", departmentCode: "CS", professorCode: "P-1001" },
  { code: "ENG101", name: "التحليل الرياضي 1", departmentCode: "ENG", professorCode: "P-1002" },
  { code: "ENG102", name: "الفيزياء الهندسية 1", departmentCode: "ENG", professorCode: "P-1002" },
  { code: "BUS101", name: "مبادئ المحاسبة", departmentCode: "BUS", professorCode: "P-1003" },
  { code: "BUS102", name: "التسويق الرقمي", departmentCode: "BUS", professorCode: "P-1003" },
];

const students = [
  { fullName: "أحمد محمد عبد الله", departmentCode: "CS", academicYear: 2, rate: 0.45 },
  { fullName: "منى طارق الجندي", departmentCode: "CS", academicYear: 2, rate: 0.62 },
  { fullName: "خالد السيد أحمد", departmentCode: "CS", academicYear: 1, rate: 0.9 },
  { fullName: "سامي النجار محمود", departmentCode: "CS", academicYear: 3, rate: 0.84 },
  { fullName: "نهى مصطفى سالم", departmentCode: "CS", academicYear: 1, rate: 0.95 },
  { fullName: "محمد عبد الله السيد", departmentCode: "ENG", academicYear: 2, rate: 0.7 },
  { fullName: "عمر حسن إبراهيم", departmentCode: "ENG", academicYear: 3, rate: 0.88 },
  { fullName: "هدى علي محمود", departmentCode: "ENG", academicYear: 1, rate: 0.93 },
  { fullName: "يوسف طارق عبد العزيز", departmentCode: "ENG", academicYear: 2, rate: 0.66 },
  { fullName: "حسن إبراهيم علي", departmentCode: "BUS", academicYear: 1, rate: 0.86 },
  { fullName: "دينا شريف حسن", departmentCode: "BUS", academicYear: 2, rate: 0.91 },
  { fullName: "كريم سمير كمال", departmentCode: "BUS", academicYear: 3, rate: 0.58 },
];

const announcementTitles = [
  "تعلن المادة عن موعد تسليم المشروع النهائي",
  "مراجعة شاملة قبل الامتحان النصفي",
  "إعلان نتائج مسابقة المختبرات",
  "تغيير موعد المحاضرة العملية",
  "صدور نسخة جديدة من ملخصات الوحدة الثانية",
];

function attendanceStatus(roll, rate) {
  if (roll < rate) return AttendanceStatus.PRESENT;
  if (roll % 9 === 0) return AttendanceStatus.EXCUSED;
  return AttendanceStatus.ABSENT;
}

async function seedAdmin() {
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  const fullName = process.env.SEED_ADMIN_NAME?.trim() || "مدير النظام";

  if (!email || !password) {
    throw new Error("حدد SEED_ADMIN_EMAIL و SEED_ADMIN_PASSWORD قبل تنفيذ تهيئة قاعدة البيانات.");
  }

  const passwordHash = await bcrypt.hash(password, 12);

  return prisma.user.upsert({
    where: { email },
    update: { fullName, passwordHash, role: UserRole.ADMIN, isActive: true },
    create: { email, fullName, passwordHash, role: UserRole.ADMIN },
  });
}

async function seedDemo(adminUser) {
  if ((await prisma.student.count()) > 0) {
    console.log("البيانات التجريبية موجودة بالفعل، تم التخطي.");
    return;
  }

  const demoPassword = process.env.SEED_DEMO_PASSWORD || "123456";
  const passwordHash = await bcrypt.hash(demoPassword, 10);

  const term = await prisma.academicTerm.create({
    data: {
      name: "الفصل الأول 2026/2027",
      startDate: new Date("2026-02-22T00:00:00.000Z"),
      endDate: new Date("2026-06-25T00:00:00.000Z"),
      isCurrent: true,
    },
  });

  const departmentByCode = new Map();

  for (const department of departments) {
    const created = await prisma.department.create({
      data: { name: department.name, code: department.code, description: `قسم ${department.name}` },
    });
    departmentByCode.set(department.code, created);
  }

  const professorByCode = new Map();

  for (const professor of professors) {
    const user = await prisma.user.create({
      data: {
        email: professor.email,
        fullName: professor.fullName,
        passwordHash,
        role: UserRole.PROFESSOR,
      },
    });

    const created = await prisma.professor.create({
      data: {
        userId: user.id,
        employeeCode: professor.employeeCode,
        departmentId: departmentByCode.get(professor.departmentCode).id,
      },
    });

    // Capabilities are denied by default, so each demo professor must be granted explicitly.
    for (const permission of professor.permissions) {
      await prisma.professorPermission.create({
        data: { professorId: created.id, permission, grantedById: adminUser.id },
      });
    }

    professorByCode.set(professor.employeeCode, created);
  }

  const subjectByCode = new Map();

  for (const subject of subjects) {
    const created = await prisma.subject.create({
      data: {
        code: subject.code,
        name: subject.name,
        creditHours: 3,
        attendanceLimit: 75,
        departmentId: departmentByCode.get(subject.departmentCode).id,
        academicTermId: term.id,
        professors: {
          create: { professorId: professorByCode.get(subject.professorCode).id, isPrimary: true },
        },
      },
    });

    subjectByCode.set(subject.code, { ...subject, id: created.id });
  }

  const studentRecords = [];

  for (const [index, student] of students.entries()) {
    const sequence = index + 1;
    const user = await prisma.user.create({
      data: {
        email: `student${sequence}@university.edu`,
        fullName: student.fullName,
        passwordHash,
        role: UserRole.STUDENT,
        lastLoginAt: new Date(Date.UTC(2026, 3, 5 + (index % 10), 9, 30)),
      },
    });

    const created = await prisma.student.create({
      data: {
        userId: user.id,
        universityId: `2026${String(sequence).padStart(4, "0")}`,
        phone: `0100${String(1000000 + sequence * 137).slice(0, 7)}`,
        academicYear: student.academicYear,
        departmentId: departmentByCode.get(student.departmentCode).id,
      },
    });

    studentRecords.push({
      ...created,
      fullName: student.fullName,
      email: user.email,
      rate: student.rate,
      departmentCode: student.departmentCode,
      index,
    });
  }

  const subjectList = [...subjectByCode.values()];
  const sessionCount = 8;

  for (const [subjectIndex, subject] of subjectList.entries()) {
    const professorId = professorByCode.get(subject.professorCode).id;
    const studentsOfSubject = studentRecords.filter(
      (student) => student.departmentCode === subject.departmentCode,
    );

    await prisma.enrollment.createMany({
      data: studentsOfSubject.map((student) => ({
        studentId: student.id,
        subjectId: subject.id,
        status: EnrollmentStatus.ACTIVE,
      })),
      skipDuplicates: true,
    });

    for (let sessionIndex = 0; sessionIndex < sessionCount; sessionIndex += 1) {
      const session = await prisma.attendanceSession.create({
        data: {
          subjectId: subject.id,
          createdById: professorId,
          date: new Date(Date.UTC(2026, 2, 22 + sessionIndex * 7)),
          title: `محاضرة ${sessionIndex + 1}`,
        },
      });

      await prisma.attendanceRecord.createMany({
        data: studentsOfSubject.map((student) => {
          const roll = (sessionIndex * 7 + student.index * 3 + subjectIndex) % 20;
          return {
            sessionId: session.id,
            studentId: student.id,
            status: attendanceStatus(roll, Math.round(student.rate * 20)),
          };
        }),
        skipDuplicates: true,
      });
    }

    const exam = await prisma.exam.create({
      data: {
        subjectId: subject.id,
        createdById: professorId,
        title: `امتحان ${subject.name} - أعمال السنة`,
        description: "امتحان شامل يغطي جميع الوحدات الدراسية.",
        startsAt: new Date(Date.UTC(2026, 3, 20, 10)),
        endsAt: new Date(Date.UTC(2026, 3, 20, 12)),
        durationMin: 90,
        totalScore: 100,
        status: ExamStatus.CLOSED,
      },
    });

    const questions = [];

    for (const [questionIndex, type] of [
      QuestionType.MULTIPLE_CHOICE,
      QuestionType.MULTIPLE_CHOICE,
      QuestionType.TRUE_FALSE,
      QuestionType.SHORT_ANSWER,
    ].entries()) {
      const question = await prisma.question.create({
        data: {
          subjectId: subject.id,
          createdById: professorId,
          text: `سؤال ${questionIndex + 1} من امتحان ${subject.name}`,
          type,
          difficulty: questionIndex % 2 === 0 ? DifficultyLevel.EASY : DifficultyLevel.MEDIUM,
          unit: `الوحدة ${questionIndex + 1}`,
          correctAnswer: type === QuestionType.TRUE_FALSE ? "true" : "الإجابة النموذجية",
          options:
            type === QuestionType.MULTIPLE_CHOICE
              ? {
                  create: [
                    { text: "الخيار الأول", isCorrect: true, position: 1 },
                    { text: "الخيار الثاني", isCorrect: false, position: 2 },
                    { text: "الخيار الثالث", isCorrect: false, position: 3 },
                  ],
                }
              : undefined,
        },
      });

      questions.push({ id: question.id, score: 25 });

      await prisma.examQuestion.create({
        data: { examId: exam.id, questionId: question.id, position: questionIndex + 1, score: 25 },
      });
    }

    for (const student of studentsOfSubject) {
      const score = Math.max(
        10,
        Math.min(100, Math.round(student.rate * 100 * 0.9 + subjectIndex * 2)),
      );

      const attempt = await prisma.examAttempt.create({
        data: {
          examId: exam.id,
          studentId: student.id,
          status: AttemptStatus.GRADED,
          startedAt: new Date(Date.UTC(2026, 3, 20, 10, 5 + student.index)),
          submittedAt: new Date(Date.UTC(2026, 3, 20, 11, 20 + student.index)),
          score,
          feedback: score >= 50 ? "أداء جيد، واصل التقدم." : "يحتاج إلى مراجعة مكثفة للمقرر.",
        },
      });

      await prisma.examAnswer.createMany({
        data: questions.map((question, index) => ({
          attemptId: attempt.id,
          questionId: question.id,
          answer: index % 2 === 0 ? "الإجابة النموذجية" : "إجابة الطالب",
          score: index < Math.round(score / 25) ? 25 : 5,
          isCorrect: index < Math.round(score / 25),
        })),
        skipDuplicates: true,
      });
    }
  }

  for (const [subjectIndex, subject] of subjectList.entries()) {
    for (const [announcementIndex, title] of announcementTitles.slice(0, 2).entries()) {
      await prisma.announcement.create({
        data: {
          subjectId: subject.id,
          authorId: (
            await prisma.professor.findFirstOrThrow({
              where: { subjects: { some: { subjectId: subject.id, isPrimary: true } } },
              select: { userId: true },
            })
          ).userId,
          title,
          content: `تفاصيل ${title} في مادة ${subject.name}. يرجى الاطلاع على التفاصيل في صفحة المادة.`,
          isPinned: announcementIndex === 0 && subjectIndex === 0,
          publishedAt: new Date(Date.UTC(2026, 2, 25 + subjectIndex)),
        },
      });
    }
  }

  await prisma.auditLog.createMany({
    data: [
      { userId: null, action: "student.create", entity: "Student", metadata: { source: "seed" } },
      { action: "auth.login", entity: "User", metadata: { source: "seed" } },
      { action: "subject.create", entity: "Subject", metadata: { source: "seed" } },
      { action: "attendance.create", entity: "AttendanceSession", metadata: { source: "seed" } },
      { action: "exam.create", entity: "Exam", metadata: { source: "seed" } },
      { action: "announcement.create", entity: "Announcement", metadata: { source: "seed" } },
    ],
  });

  console.log(
    `تمت تعبئة البيانات التجريبية: ${subjects.length} مواد، ${professors.length} أعضاء تدريس، ${students.length} طلاب.`,
  );
  console.log(`كلمة مرور الحسابات التجريبية: ${demoPassword}`);
}

async function main() {
  const adminUser = await seedAdmin();
  console.log("تم تجهيز حساب مدير النظام.");
  await seedDemo(adminUser);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    await prisma.$disconnect();
    throw error;
  });
