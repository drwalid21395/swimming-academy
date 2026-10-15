const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({ select: { email: true, fullName: true, role: true } });
  for (const user of users) {
    console.log(user.role, user.email, Buffer.from(user.fullName, "utf8").toString("hex"));
  }
  const counts = {
    departments: await prisma.department.count(),
    subjects: await prisma.subject.count(),
    students: await prisma.student.count(),
    professors: await prisma.professor.count(),
  };
  console.log(JSON.stringify(counts));
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    await prisma.$disconnect();
    throw error;
  });
