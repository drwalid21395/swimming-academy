-- Adds the serial number that students carry in the uploaded Excel file.
--
-- Nullable on purpose: the `رقم المسلسل` column is optional in the template, and
-- a roster that leaves it blank must still import. Non-unique on purpose for the
-- same reason as `universityId`: a repeated or blank value must not fail an
-- import, so the number is a label rather than an identity.
ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "serial" TEXT;

CREATE INDEX IF NOT EXISTS "Student_serial_idx" ON "Student"("serial");