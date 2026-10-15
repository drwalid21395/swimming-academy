// Seeds the local database with a platform the size the real one is reported to
// be (500-2000 students) plus a known admin login, so the attendance pages can be
// opened in a real browser and the freeze reproduced rather than argued about.
//
// Tagged with SEED and safe to re-run.
const path = require("node:path");

const { loadTs } = require("./.verify/loader.cjs");
const load = (relative) => loadTs(path.join(process.cwd(), relative));

const { prisma } = load("src/lib/prisma.ts");

const TAG = "SEED";
const SUBJECTS = 8;
const STUDENTS = 2000;
const SESSIONS_PER_SUBJECT = 40;
const ADMIN_EMAIL = "seed-admin@verify.test";
const ADMIN_PASSWORD = "SeedAdmin@2026";
const PROF_EMAIL = "seed-prof@verify.test";
const PROF_PASSWORD = "SeedProf@2026";

async function clear() {
  await prisma.subject.deleteMany({ where: { code: { startsWith: TAG } } });
  await prisma.student.deleteMany({ where: { universityId: { startsWith: TAG } } });
  // The tagged rows use the upper-case tag; the two login accounts use a
  // lower-case prefix, and the match is case sensitive.
  await prisma.user.deleteMany({
    where: {
      OR: [{ email: { startsWith: TAG } }, { email: { contains: "seed-" } }],
    },
  });
  await prisma.academicTerm.deleteMany({ where: { name: { startsWith: TAG } } });
}

async function main() {
  // `node .seed-realistic.cjs --clean` removes only the tagged rows and stops,
  // so the local development database can be returned to its normal size after
  // reproducing a large-platform problem.
  if (process.argv.includes("--clean")) {
    console.log("removing the seed data");
    await clear();
    console.log("done");
    return;
  }

  console.log("clearing any previous seed");
  await clear();

  const bcrypt = require("bcryptjs");

  const department =
    (await prisma.department.findFirst()) ??
    (await prisma.department.create({
      data: { name: `${TAG} قسم`, code: `${TAG}-D` },
      select: { id: true },
    }));

  const term = await prisma.academicTerm.create({
    data: { name: `${TAG} فصل`, startDate: new Date("2025-09-01"), endDate: new Date("2026-06-30") },
    select: { id: true },
  });

  const admin = await prisma.user.create({
    data: {
      email: ADMIN_EMAIL,
      passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 10),
      fullName: `${TAG} مدير النظام`,
      role: "ADMIN",
    },
    select: { id: true },
  });

  const professorUser = await prisma.user.create({
    data: {
      email: PROF_EMAIL,
      passwordHash: await bcrypt.hash(PROF_PASSWORD, 10),
      fullName: `${TAG} دكتور`,
      role: "PROFESSOR",
    },
    select: { id: true },
  });

  const professor = await prisma.professor.create({
    data: {
      userId: professorUser.id,
      employeeCode: `${TAG}-P1`,
      departmentId: department.id,
    },
    select: { id: true },
  });

  await prisma.professorPermission.create({
    data: { professorId: professor.id, permission: "ATTENDANCE_RECORD", grantedById: admin.id },
  });

  const subjects = [];
  for (let s = 0; s < SUBJECTS; s += 1) {
    subjects.push(
      await prisma.subject.create({
        data: {
          code: `${TAG}-S${s}`,
          name: `${TAG} مادة ${s}`,
          departmentId: department.id,
          academicTermId: term.id,
        },
        select: { id: true },
      }),
    );
    await prisma.subjectProfessor.create({
      data: { subjectId: subjects[s].id, professorId: professor.id, isPrimary: true },
    });
  }

  console.log(`creating ${STUDENTS} students`);
  // One shared placeholder hash keeps the insert to two round trips instead of
  // 4000; these students are never signed into, only listed.
  const placeholderHash = await bcrypt.hash("NotASignedInAccount", 10);

  await prisma.user.createMany({
    data: Array.from({ length: STUDENTS }, (_, i) => ({
      email: `${TAG}-s${i}@verify.test`,
      passwordHash: placeholderHash,
      fullName: `${TAG} طالب ${i}`,
      role: "STUDENT",
    })),
  });

  const users = await prisma.user.findMany({
    where: { email: { startsWith: `${TAG}-s` } },
    select: { id: true },
  });
  const usersByEmail = new Map(users.map((user) => [user.id, user.id]));

  const ordered = await prisma.user.findMany({
    where: { email: { startsWith: `${TAG}-s` } },
    orderBy: { email: "asc" },
    select: { id: true, email: true },
  });

  await prisma.student.createMany({
    data: ordered.map((user, i) => ({
      userId: user.id,
      universityId: `${TAG}${String(i).padStart(5, "0")}`,
      serial: String(i + 1),
      academicYear: (i % 4) + 1,
      departmentId: department.id,
    })),
  });

  const studentRows = await prisma.student.findMany({
    where: { universityId: { startsWith: TAG } },
    orderBy: { universityId: "asc" },
    select: { id: true },
  });
  const studentIds = studentRows.map((row) => row.id);

  console.log("enrolling every student in the first four subjects");
  await prisma.enrollment.createMany({
    data: subjects
      .slice(0, 4)
      .flatMap((subject) =>
        studentIds.map((studentId) => ({ subjectId: subject.id, studentId, status: "ACTIVE" })),
      ),
  });

  const statuses = ["PRESENT", "ABSENT", "EXCUSED"];
  let records = 0;

  for (const subject of subjects.slice(0, 4)) {
    console.log(`  ${SESSIONS_PER_SUBJECT} sessions with full marks`);
    await prisma.attendanceSession.createMany({
      data: Array.from({ length: SESSIONS_PER_SUBJECT }, (_, d) => ({
        subjectId: subject.id,
        createdById: professor.id,
        date: new Date(Date.UTC(2025, 8, 1 + d)),
        title: `${TAG} محاضرة ${d + 1}`,
      })),
    });

    const sessions = await prisma.attendanceSession.findMany({
      where: { subjectId: subject.id },
      orderBy: { date: "asc" },
      select: { id: true },
    });

    for (const session of sessions) {
      await prisma.attendanceRecord.createMany({
        data: studentIds.map((studentId, i) => ({
          sessionId: session.id,
          studentId,
          status: i % 7 === 0 ? statuses[1] : statuses[i % 3],
        })),
      });
      records += studentIds.length;
    }
  }

  const counts = await prisma.$queryRawUnsafe(
    `SELECT
       (SELECT COUNT(*) FROM "AttendanceSession") AS sessions,
       (SELECT COUNT(*) FROM "AttendanceRecord") AS records,
       (SELECT COUNT(*) FROM "Enrollment" WHERE status='ACTIVE') AS enrollments,
       (SELECT COUNT(*) FROM "Student") AS students`,
  );

  console.log(`\nseeded: ${counts[0].students} students, ${counts[0].enrollments} enrollments, ${counts[0].sessions} sessions, ${counts[0].records} records`);
  console.log(`\nadmin login:    ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  console.log(`professor login: ${PROF_EMAIL} / ${PROF_PASSWORD}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });