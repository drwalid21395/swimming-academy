const { loadTs } = require("./loader.cjs");
const path = require("node:path");
const load = (relative) => loadTs(path.join(process.cwd(), relative));
const { prisma } = load("src/lib/prisma.ts");

const sql = [
  'SELECT (SELECT COUNT(*) FROM "Student") AS students,',
  '(SELECT COUNT(*) FROM "AttendanceRecord") AS records,',
  "(SELECT COUNT(*) FROM \"User\" WHERE email ILIKE '%seed%') AS seed_users,",
  "(SELECT COUNT(*) FROM \"Subject\" WHERE code LIKE 'SEED%') AS seed_subjects",
].join(" ");

prisma
  .$queryRawUnsafe(sql)
  .then((rows) => {
    const plain = Object.fromEntries(
      Object.entries(rows[0]).map(([key, value]) => [key, Number(value)]),
    );
    console.log("remaining:", JSON.stringify(plain));
    return prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
