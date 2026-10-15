-- Additive-only migration for the granular professor permission system.
-- Safe to run repeatedly: every statement is guarded with IF NOT EXISTS.
-- This performs NO destructive operation (no DROP, no column removal).

-- 1. Capability enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ProfessorPermissionKey') THEN
    CREATE TYPE "ProfessorPermissionKey" AS ENUM (
      'SUBJECTS_MANAGE',
      'QUESTIONS_MANAGE',
      'EXAMS_MANAGE',
      'RESULTS_VIEW',
      'ANNOUNCEMENTS_PUBLISH'
    );
  END IF;
END
$$;

-- 2. Grant table
CREATE TABLE IF NOT EXISTS "ProfessorPermission" (
  "id"          TEXT        NOT NULL,
  "professorId" TEXT        NOT NULL,
  "permission"  "ProfessorPermissionKey" NOT NULL,
  "grantedById" TEXT,
  "grantedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProfessorPermission_pkey" PRIMARY KEY ("id")
);

-- 3. Lookup index for "which permissions does this professor hold"
CREATE INDEX IF NOT EXISTS "ProfessorPermission_professorId_permission_idx"
  ON "ProfessorPermission" ("professorId", "permission");

-- 4. Lookup index for "who holds this capability"
CREATE INDEX IF NOT EXISTS "ProfessorPermission_permission_idx"
  ON "ProfessorPermission" ("permission");

-- 5. One row per professor + capability
CREATE UNIQUE INDEX IF NOT EXISTS "ProfessorPermission_professorId_permission_key"
  ON "ProfessorPermission" ("professorId", "permission");

-- 6. Foreign keys
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ProfessorPermission_professorId_fkey'
  ) THEN
    ALTER TABLE "ProfessorPermission"
      ADD CONSTRAINT "ProfessorPermission_professorId_fkey"
      FOREIGN KEY ("professorId") REFERENCES "Professor"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ProfessorPermission_grantedById_fkey'
  ) THEN
    ALTER TABLE "ProfessorPermission"
      ADD CONSTRAINT "ProfessorPermission_grantedById_fkey"
      FOREIGN KEY ("grantedById") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;
