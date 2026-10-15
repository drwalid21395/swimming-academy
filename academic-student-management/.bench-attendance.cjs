// Reproduces the attendance page at production scale, then times each query the
// list page runs so a slow one can be identified instead of guessed at.
//
// Everything it creates is tagged with the BENCH code prefix and removed at the
// end, so the database is left as it was found.
const path = require("node:path");

const { loadTs } = require("./.verify/loader.cjs");
const load = (relative) => loadTs(path.join(process.cwd(), relative));

const { prisma } = load("src/lib/prisma.ts");
const { listAttendanceSessions, getAttendanceSheet, getSessionSubjects } = load("src/lib/attendance.ts");

const TAG = "BENCH";
const SUBJECT_COUNT = 6;
const STUDENTS_PER_SUBJECT = 150;
const SESSIONS_PER_SUBJECT = 60;
const LIMIT = 12;

async function time(label, fn) {
  const started = process.hrtime.bigint();
  const value = await fn();
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  console.log(`  ${ms.toFixed(0).padStart(6)} ms  ${label}`);
  return { ms, value };
}

async function setup() {
  console.log(`building ${SUBJECT_COUNT} subjects x ${STUDENTS_PER_SUBJECT} students x ${SESSIONS_PER_SUBJECT} sessions\n`);

  // A previous run that failed midway would leave tagged rows behind, and the
  // unique codes would make this one fail too.
  await teardown({ silent: true });

  const department = await prisma.department.findFirst();
  if (!department) throw new Error("no department to attach the benchmark data to");

  const term =
    (await prisma.academicTerm.findFirst()) ??
    (await prisma.academicTerm.create({
      data: { name: `${TAG} term`, code: `${TAG}-TERM`, isCurrent: false },
      select: { id: true },
    }));

  const adminUser = await prisma.user.findFirst({
    where: { professor: { isNot: null } },
    select: { professor: { select: { id: true } } },
  });
  if (!adminUser?.professor) throw new Error("need one professor to own the sessions");

  const subjects = [];
  for (let s = 0; s < SUBJECT_COUNT; s += 1) {
    subjects.push(
      await prisma.subject.create({
        data: {
          code: `${TAG}-S${s}`,
          name: `${TAG} subject ${s}`,
          departmentId: department.id,
          academicTermId: term.id,
        },
        select: { id: true },
      }),
    );
  }

  const users = [];
  const students = [];
  for (let i = 0; i < STUDENTS_PER_SUBJECT; i += 1) {
    const user = await prisma.user.create({
      data: {
        email: `${TAG}-student-${i}@verify.test`,
        passwordHash: "x",
        fullName: `${TAG} طالب ${i}`,
        role: "STUDENT",
      },
      select: { id: true },
    });
    users.push(user.id);
    students.push(
      await prisma.student.create({
        data: {
          userId: user.id,
          universityId: `${TAG}${String(i).padStart(4, "0")}`,
          academicYear: i % 4,
          departmentId: department.id,
        },
        select: { id: true },
      }),
    );
  }

  await prisma.enrollment.createMany({
    data: subjects.flatMap((subject) =>
      students.map((student) => ({ subjectId: subject.id, studentId: student.id, status: "ACTIVE" })),
    ),
  });

  const statuses = ["PRESENT", "ABSENT", "EXCUSED"];
  let totalRecords = 0;

  for (const subject of subjects) {
    const sessions = [];
    for (let d = 0; d < SESSIONS_PER_SUBJECT; d += 1) {
      sessions.push(
        await prisma.attendanceSession.create({
          data: {
            subjectId: subject.id,
            createdById: adminUser.professor.id,
            date: new Date(Date.UTC(2025, 0, 1 + d)),
            title: `${TAG} lecture ${d}`,
          },
          select: { id: true },
        }),
      );
    }

    for (const session of sessions) {
      await prisma.attendanceRecord.createMany({
        data: students.map((student, i) => ({
          sessionId: session.id,
          studentId: student.id,
          // Every fifth student is chronically absent, so the low-attendance
          // filter has real work to do rather than short-circuiting.
          status: i % 5 === 0 ? statuses[1] : statuses[i % 3],
        })),
      });
      totalRecords += students.length;
    }
  }

  console.log(`created ${totalRecords} attendance records\n`);
  return { subjects, sessionSample: null, students, userIds: users, adminUserId: adminUser.professor.id };
}

async function teardown(state) {
  if (!state?.silent) console.log("\nremoving the benchmark data");
  await prisma.subject.deleteMany({ where: { code: { startsWith: TAG } } });
  await prisma.student.deleteMany({ where: { universityId: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
  await prisma.academicTerm.deleteMany({ where: { name: { startsWith: TAG } } });
}

async function main() {
  const state = await setup();
  const subjectIds = state.subjects.map((subject) => subject.id);

  const session = await prisma.attendanceSession.findFirst({
    where: { subjectId: subjectIds[0] },
    select: { id: true },
  });

  const stats = await prisma.$queryRawUnsafe(
    `SELECT
       (SELECT COUNT(*) FROM "AttendanceSession") AS sessions,
       (SELECT COUNT(*) FROM "AttendanceRecord") AS records,
       (SELECT COUNT(*) FROM "Enrollment" WHERE status = 'ACTIVE') AS enrollments`,
  );
  console.log(`database now holds ${stats[0].sessions} sessions / ${stats[0].records} records / ${stats[0].enrollments} active enrollments\n`);

  console.log("the professor attendance list page, query by query");

  await time("attendanceSession.count (filtered page)", () =>
    prisma.attendanceSession.count({ where: { subjectId: { in: subjectIds } } }),
  );
  await time("enrollment.count", () =>
    prisma.enrollment.count({ where: { status: "ACTIVE", subjectId: { in: subjectIds } } }),
  );
  await time("attendanceSession.findMany (10 rows, nested records)", () =>
    prisma.attendanceSession.findMany({
      where: { subjectId: { in: subjectIds } },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 10,
      select: {
        id: true,
        date: true,
        title: true,
        records: { select: { status: true } },
        subject: {
          select: {
            id: true,
            enrollments: { where: { status: "ACTIVE" }, select: { id: true } },
          },
        },
      },
    }),
  );
  await time("attendanceRecord.groupBy by status (whole scope)", () =>
    prisma.attendanceRecord.groupBy({
      by: ["status"],
      _count: { _all: true },
      where: { session: { subjectId: { in: subjectIds } } },
    }),
  );
  await time("low-attendance raw aggregate (whole scope)", () =>
    prisma.$queryRawUnsafe(
      `SELECT s."subjectId", r."studentId", r."status", COUNT(*) AS "count"
       FROM "AttendanceRecord" r
       JOIN "AttendanceSession" s ON s."id" = r."sessionId"
       WHERE s."subjectId" IN (${subjectIds.map((id) => `'${id}'`).join(",")})
       GROUP BY s."subjectId", r."studentId", r."status"`,
    ),
  );
  await time("getSessionSubjects", () => getSessionSubjects({ subjectIds }));

  const list = await time("listAttendanceSessions (whole page)", () =>
    listAttendanceSessions({ page: 1, pageSize: 10 }, { subjectIds }),
  );
  console.log(`         -> ${list.value.rows.length} rows, ${list.value.lowAttendance.length} low attendance`);

  console.log("\nthe attendance sheet page");
  await time("attendanceRecord.groupBy per student (one subject, all history)", () =>
    prisma.attendanceRecord.groupBy({
      by: ["studentId", "status"],
      _count: { _all: true },
      where: { sessionId: { not: session.id }, session: { subjectId: subjectIds[0] } },
    }),
  );
  const sheet = await time("getAttendanceSheet (whole sheet)", () =>
    getAttendanceSheet(session.id, { subjectIds }),
  );
  console.log(`         -> ${sheet.value.rows.length} student rows`);

  await teardown(state);
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