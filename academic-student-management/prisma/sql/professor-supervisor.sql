-- Lets an administrator attach one or more assisting staff members to a
-- professor, and turn attendance into a capability they can hand out.
--
-- Additive-only and safe to run repeatedly: every statement is guarded, and the
-- file performs no destructive operation. The name sorts after
-- `professor-permissions-attendance-record.sql`, which is what creates the
-- `ATTENDANCE_RECORD` value the backfill below writes.

-- 1. Kind enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ProfessorKind') THEN
    CREATE TYPE "ProfessorKind" AS ENUM ('PROFESSOR', 'ASSISTANT');
  END IF;
END
$$;

-- 2. Columns
ALTER TABLE "Professor" ADD COLUMN IF NOT EXISTS "kind" "ProfessorKind" NOT NULL DEFAULT 'PROFESSOR';

ALTER TABLE "Professor" ADD COLUMN IF NOT EXISTS "supervisorId" TEXT;

-- 3. Index for "which assistants does this professor supervise"
CREATE INDEX IF NOT EXISTS "Professor_supervisorId_idx" ON "Professor" ("supervisorId");

-- 4. Foreign key
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Professor_supervisorId_fkey'
  ) THEN
    ALTER TABLE "Professor"
      ADD CONSTRAINT "Professor_supervisorId_fkey"
      FOREIGN KEY ("supervisorId") REFERENCES "Professor"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

-- 5. Attendance is now a capability like the others, so every professor who
--    already had it (they all did: attendance was not gated before) keeps it.
--    Only the main teaching staff is backfilled, never an assistant.
INSERT INTO "ProfessorPermission" ("id", "professorId", "permission", "grantedAt")
SELECT
  md5(random()::text || clock_timestamp()::text || p."id"),
  p."id",
  'ATTENDANCE_RECORD',
  CURRENT_TIMESTAMP
FROM "Professor" p
WHERE p."kind" = 'PROFESSOR'
  AND NOT EXISTS (
    SELECT 1
    FROM "ProfessorPermission" pp
    WHERE pp."professorId" = p."id" AND pp."permission" = 'ATTENDANCE_RECORD'
  );