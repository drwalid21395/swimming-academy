const { loadTs } = require("./loader.cjs");
const path = require("node:path");
const load = (r) => loadTs(path.join(process.cwd(), r));
(async () => {
  const { prisma } = load("src/lib/prisma.ts");
  const s = await prisma.attendanceSession.findFirst({ orderBy: { date: "desc" }, select: { id: true, subjectId: true, subject: { select: { name: true } } } });
  const count = await prisma.enrollment.count({ where: { subjectId: s.subjectId } });
  const recs = await prisma.attendanceRecord.count({ where: { sessionId: s.id } });
  console.log("session", s.id, s.subject.name, "enrollments", count, "records", recs);
  await prisma.$disconnect();
})();
