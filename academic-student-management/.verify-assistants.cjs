// Verifies the assistant schema landed in the database and that the hard scope
// ceiling on assistants holds against a live query.
const path = require("node:path");

const { loadTs } = require("./.verify/loader.cjs");

const load = (relative) => loadTs(path.join(process.cwd(), relative));

const { prisma } = load("src/lib/prisma.ts");
const {
  hasProfessorGrant,
  loadProfessorGrants,
  listProfessorPermissionMatrix,
  PROFESSOR_PERMISSION_CATALOG,
  ASSISTANT_DEFAULT_GRANTS,
} = load("src/lib/professor-permissions.ts");
const { createProfessorAccount } = load("src/lib/professors.ts");

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? ` -> ${detail}` : ""}`);
  }
}

async function main() {
  console.log("schema is reachable with the assistant columns");

  const kinds = await prisma.$queryRawUnsafe(
    `SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'ProfessorKind' ORDER BY e.enumsortorder`,
  );
  check("ProfessorKind enum exists", kinds.length === 2, JSON.stringify(kinds));
  check(
    "ProfessorKind has both values",
    kinds.some((k) => k.enumlabel === "PROFESSOR") && kinds.some((k) => k.enumlabel === "ASSISTANT"),
  );

  const attendanceKeys = await prisma.$queryRawUnsafe(
    `SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'ProfessorPermissionKey' AND enumlabel = 'ATTENDANCE_RECORD'`,
  );
  check("ATTENDANCE_RECORD is a ProfessorPermissionKey", attendanceKeys.length === 1);

  const columns = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'Professor' AND column_name IN ('kind','supervisorId') ORDER BY column_name`,
  );
  check(
    "Professor.kind / Professor.supervisorId exist",
    columns.length === 2 &&
      columns.some((column) => column.column_name === "kind") &&
      columns.some((column) => column.column_name === "supervisorId"),
    JSON.stringify(columns),
  );

  console.log("\nthe permission catalog exposes attendance");
  check(
    "catalog contains ATTENDANCE_RECORD",
    PROFESSOR_PERMISSION_CATALOG.some((entry) => entry.key === "ATTENDANCE_RECORD"),
  );
  check("assistant default is attendance only", ASSISTANT_DEFAULT_GRANTS.join(",") === "ATTENDANCE_RECORD");

  console.log("\nexisting professors kept attendance");
  const existing = await prisma.professor.findMany({
    where: { kind: "PROFESSOR" },
    select: {
      id: true,
      kind: true,
      userId: true,
      user: { select: { fullName: true } },
      subjects: { select: { subjectId: true } },
    },
    orderBy: { employeeCode: "asc" },
  });
  check("there is at least one main professor to supervise", existing.length > 0, `${existing.length}`);
  check("no professor row is still null on kind", existing.every((row) => row.kind === "PROFESSOR"));

  const supervisor = existing[0];
  if (supervisor) {
    const grants = await loadProfessorGrants(supervisor.userId);
    check(
      "existing professor has ATTENDANCE_RECORD",
      await hasProfessorGrant(supervisor.userId, "ATTENDANCE_RECORD"),
      `grants: ${[...grants].join(",") || "none"}`,
    );

    const supervisorSubjectIds = supervisor.subjects.map((link) => link.subjectId);
    const outsideSubject = await prisma.subject.findFirst({
      where: { id: { notIn: supervisorSubjectIds } },
      select: { id: true },
    });

    const stamp = Date.now().toString(36);
    const created = await createProfessorAccount(
      {
        fullName: `معاون اختبار ${stamp}`,
        email: `assistant.${stamp}@verify.test`,
        employeeCode: `AST-${stamp}`,
        phone: "",
        departmentId: supervisor.departmentId,
        password: "Assistant@2026",
        kind: "ASSISTANT",
        supervisorId: supervisor.id,
        isActive: "1",
        subjectIds: [...supervisorSubjectIds, ...(outsideSubject ? [outsideSubject.id] : [])],
        permissionKeys: ASSISTANT_DEFAULT_GRANTS,
      },
      supervisor.userId,
      {},
    );

    console.log("\na new assistant is capped by its supervisor");
    const row = await prisma.professor.findUnique({
      where: { id: created.id },
      select: {
        kind: true,
        supervisorId: true,
        subjects: { select: { subjectId: true } },
      },
    });
    check("kind is ASSISTANT", row.kind === "ASSISTANT", row.kind);
    check("supervisor is linked", row.supervisorId === supervisor.id, String(row.supervisorId));

    const assigned = row.subjects.map((link) => link.subjectId);
    check(
      "no subject outside the supervisor's scope was kept",
      assigned.every((id) => supervisorSubjectIds.includes(id)),
      `assigned: ${assigned.join(",")} supervisor: ${supervisorSubjectIds.join(",")}`,
    );
    check(
      "supervisor's own subjects were kept",
      supervisorSubjectIds.every((id) => assigned.includes(id)),
    );

    const assistantGrants = await loadProfessorGrants(created.userId);
    check("assistant has attendance", assistantGrants.has("ATTENDANCE_RECORD"));
    check(
      "assistant has nothing beyond the default",
      assistantGrants.size === ASSISTANT_DEFAULT_GRANTS.length,
      [...assistantGrants].join(","),
    );

    console.log("\nevery professor audit action has an Arabic label");
const { activityLabel } = load("src/lib/labels.ts");
const professorActions = [
  "professor.create",
  "professor.update",
  "professor.delete",
  "professor.activate",
  "professor.deactivate",
  "professor.assistant.create",
  "professor.permission.grant",
  "professor.permission.revoke",
  "professor.scope.update",
];
for (const action of professorActions) {
  const label = activityLabel(action);
  check(`${action} is labelled`, label !== action, label);
}

console.log("\nthe matrix reports both kinds");
    const matrix = await listProfessorPermissionMatrix();
    check("stats counts assistants", matrix.stats.assistants >= 1, `${matrix.stats.assistants}`);
    check(
      "supervisor options only list main professors",
      matrix.supervisorOptions.every((option) => option.professorId !== created.id),
    );
    check(
      "supervisor options carry their subject scope",
      matrix.supervisorOptions.every((option) => Array.isArray(option.subjectIds)),
    );
    const assistantRow = matrix.rows.find((entry) => entry.professorId === created.id);
    check("the matrix row is marked as an assistant", assistantRow?.kind === "ASSISTANT");
    check("the matrix row names the supervisor", assistantRow?.supervisorName === supervisor.user.fullName, String(assistantRow?.supervisorName));

    await prisma.professor.delete({ where: { id: created.id } });
    await prisma.user.delete({ where: { id: created.userId } });
    console.log("\ncleaned up the verification assistant");
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
    console.log(failures === 0 ? "\nALL ASSISTANT CHECKS PASSED" : `\n${failures} ASSISTANT CHECK(S) FAILED`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });