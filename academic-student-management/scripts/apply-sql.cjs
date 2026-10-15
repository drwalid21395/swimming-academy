/**
 * Applies the additive SQL files in `prisma/sql` to the database `DATABASE_URL`
 * points at.
 *
 * Every file is written to be safe to run repeatedly (guarded with
 * `IF NOT EXISTS` and containing no destructive statement), because this runs on
 * each build: Vercel gives every deployment a fresh build, and the production
 * schema has to already carry the columns the generated Prisma client selects.
 */
const { execFileSync } = require("node:child_process");
const { readdirSync } = require("node:fs");
const { join } = require("node:path");

const sqlDir = join(process.cwd(), "prisma", "sql");
const files = readdirSync(sqlDir)
  .filter((name) => name.endsWith(".sql"))
  .sort();

if (files.length === 0) {
  console.log("No SQL files to apply.");
  process.exit(0);
}

for (const file of files) {
  console.log(`Applying ${file}`);

  const sqlPath = join(sqlDir, file);
  const schemaPath = join(process.cwd(), "prisma", "schema.prisma");
  const useShell = process.platform === "win32";

  // With `shell: true` the arguments are re-parsed by the command interpreter,
  // so a path containing spaces (this checkout lives under "ادارة الاكاديمية")
  // has to be quoted or it gets cut at the first space.
  const args = [
    "prisma",
    "db",
    "execute",
    "--file",
    useShell ? `"${sqlPath}"` : sqlPath,
    "--schema",
    useShell ? `"${schemaPath}"` : schemaPath,
  ];

  // `shell: true` is required on Windows: node cannot spawn a `.cmd` shim
  // directly, and `npx.cmd` fails with EINVAL without it.
  execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", args, {
    stdio: "inherit",
    shell: useShell,
  });
}

console.log("SQL migrations applied.");