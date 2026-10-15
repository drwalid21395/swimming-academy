-- Adds attendance as a grantable capability.
--
-- Filename is deliberate: `apply-sql` runs `prisma/sql/*.sql` in alphabetical
-- order, and this file must come *after* `professor-permission.sql`, which is the
-- one that creates the enum. `professor-permission.sql` sorts before this file
-- because "." sorts before "s", so the type always exists by the time this runs.
--
-- The value is guarded so the file is safe to run on every build.
ALTER TYPE "ProfessorPermissionKey" ADD VALUE IF NOT EXISTS 'ATTENDANCE_RECORD';