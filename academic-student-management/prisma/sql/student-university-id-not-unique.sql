-- Allows the same reference (university) number to be shared by several students.
-- Only the email stays unique, so a row that carries no email can no longer be
-- identified by its university id alone.
DROP INDEX IF EXISTS "Student_universityId_key";

CREATE INDEX IF NOT EXISTS "Student_universityId_idx" ON "Student"("universityId");