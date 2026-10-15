import { Prisma, UserRole } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import * as XLSX from "xlsx";

import { prisma } from "@/lib/prisma";
import { resolveSpecializationForImport } from "@/lib/specializations";
import {
  normalizeHeaderLabel,
  splitTemplateOptionLabel,
  studentDefaultPassword,
  studentTemplateColumns,
  type StudentExcelKey,
} from "@/lib/student-excel";

const BCRYPT_ROUNDS = 10;
const DEFAULT_ACADEMIC_YEAR = 1;

export type ExcelRowError = { row: number; message: string };

export type ImportFeedback = {
  status: "success" | "partial" | "error";
  message: string;
  errors: ExcelRowError[];
};

export type StudentImportFeedback = ImportFeedback & {
  created: number;
  updated: number;
};

export type SubjectImportFeedback = StudentImportFeedback & {
  enrolled: number;
  alreadyEnrolled: number;
  subjectCode: string;
};

export type StudentImportResult = {
  created: number;
  updated: number;
  errors: ExcelRowError[];
};

export type SubjectImportResult = StudentImportResult & {
  enrolled: number;
  alreadyEnrolled: number;
  subjectCode: string;
};

export type ParsedStudentRow = {
  line: number;
  serial: string;
  fullName: string;
  email: string;
  universityId: string;
  phone: string;
  department: string;
  specialization: string;
  academicYear: number;
  password: string;
};

const fullNamePattern = /^(?=\S)[^\n]{4,120}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phonePattern = /^[0-9+\-\s]{6,20}$/;

/**
 * Email and university id are unique columns in the database, so a blank cell
 * gets a generated placeholder instead of failing the row. The admin can edit
 * the real value later from the student page.
 */
function generateUniqueToken() {
  return randomBytes(5).toString("hex").toUpperCase();
}

export function fillMissingIdentity(row: ParsedStudentRow): {
  email: string;
  universityId: string;
  generated: boolean;
} {
  const emailMissing = row.email.length === 0;
  const universityIdMissing = row.universityId.length === 0;

  if (!emailMissing && !universityIdMissing) {
    return { email: row.email, universityId: row.universityId, generated: false };
  }

  const token = generateUniqueToken();

  return {
    email: emailMissing ? `student-${token}@noemail.local` : row.email,
    universityId: universityIdMissing ? `AUTO-${token}` : row.universityId,
    generated: emailMissing || universityIdMissing,
  };
}

function resolveColumnIndexes(headers: unknown[]): Map<StudentExcelKey, number> {
  const map = new Map<StudentExcelKey, number>();
  const normByKey = new Map<StudentExcelKey, string>(
    studentTemplateColumns.map((column) => [column.key, normalizeHeaderLabel(column.label)]),
  );

  headers.forEach((header, index) => {
    const norm = normalizeHeaderLabel(String(header ?? "").trim());
    if (!norm) return;
    for (const [key, expected] of normByKey) {
      if (!map.has(key) && norm === expected) {
        map.set(key, index);
        break;
      }
    }
  });

  return map;
}

function hasData(row: unknown[]) {
  return row.some((cell) => String(cell ?? "").trim() !== "");
}

function parseRows(buffer: Buffer): { rows: ParsedStudentRow[]; errors: ExcelRowError[] } {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("ملف الإكسل لا يحتوي على أي ورقة بيانات.");

  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: "",
  });

  const headerIndex = aoa.findIndex(hasData);
  if (headerIndex === -1) throw new Error("ملف الإكسل فارغ.");

  const columns = resolveColumnIndexes(aoa[headerIndex]);
  const missing = studentTemplateColumns.filter((column) => column.required && !columns.has(column.key));
  if (missing.length > 0) {
    throw new Error(`الأعمدة التالية غير موجودة في الملف: ${missing.map((c) => c.label).join("، ")}.`);
  }

  const cell = (row: unknown[], key: StudentExcelKey) => {
    const index = columns.get(key);
    if (index === undefined) return "";
    const value = row[index];
    return value === null || value === undefined ? "" : String(value).trim();
  };

  const rows: ParsedStudentRow[] = [];
  const errors: ExcelRowError[] = [];

  for (let r = headerIndex + 1; r < aoa.length; r++) {
    const row = aoa[r] ?? [];
    if (!hasData(row)) continue;

    const line = r + 1;
    const rawAcademicYear = cell(row, "academicYear");
    const academicYear = rawAcademicYear === "" ? DEFAULT_ACADEMIC_YEAR : Number(rawAcademicYear);

    rows.push({
      line,
      serial: cell(row, "serial"),
      fullName: cell(row, "fullName"),
      email: cell(row, "email").toLowerCase(),
      universityId: cell(row, "universityId"),
      phone: cell(row, "phone"),
      department: cell(row, "department"),
      specialization: cell(row, "specialization"),
      academicYear,
      password: cell(row, "password"),
    });
  }

  if (rows.length === 0) errors.push({ row: headerIndex + 2, message: "لا توجد بيانات لإدخالها." });

  return { rows, errors };
}

function validateRow(row: ParsedStudentRow) {
  if (!fullNamePattern.test(row.fullName)) {
    throw new Error("الاسم الكامل مطلوب (4 أحرف على الأقل).");
  }
  if (row.email && !emailPattern.test(row.email)) {
    throw new Error("صيغة البريد الإلكتروني غير صحيحة.");
  }
if (row.universityId.length > 30) {
    throw new Error("الرقم الجامعي طويل جداً.");
  }
  if (row.serial.length > 30) {
    throw new Error("رقم المسلسل طويل جداً.");
  }
  if (row.phone && !phonePattern.test(row.phone)) {
    throw new Error("رقم الهاتف غير صالح.");
  }
  if (!row.department) {
    throw new Error("القسم مطلوب.");
  }
  if (!Number.isInteger(row.academicYear) || row.academicYear < 1 || row.academicYear > 10) {
    throw new Error("الفرقة الدراسية يجب أن تكون رقماً من 1 إلى 10.");
  }
  if (row.password && row.password.length < 8) {
    throw new Error("كلمة المرور 8 أحرف على الأقل.");
  }
}

export async function resolveDepartment(value: string) {
  const trimmed = value.trim();
  const candidates = splitTemplateOptionLabel(trimmed);
  if (candidates.length === 0) throw new Error("القسم مطلوب.");

  const department = await prisma.department.findFirst({
    where: {
      OR: [
        { code: { in: candidates, mode: "insensitive" as const } },
        { name: { in: candidates, mode: "insensitive" as const } },
      ],
    },
    select: { id: true, name: true },
  });

  if (!department) throw new Error(`القسم غير موجود: ${trimmed}.`);
  return department;
}

async function assertUniqueEmail(email: string, excludeStudentId?: string) {
  if (!email) return;

  const clash = await prisma.student.findFirst({
    where: {
      user: { email },
      ...(excludeStudentId ? { id: { not: excludeStudentId } } : {}),
    },
    select: { id: true },
  });

  if (clash) throw new Error("البريد الإلكتروني مستخدم بالفعل لطالب آخر.");
}

/**
 * The reference number is no longer unique: several students can share it. That
 * makes it useless on its own for telling students apart, so an existing record
 * is only ever matched by email, or by the reference number when it is unique
 * across all students.
 *
 * `handledIds` holds the students this same upload already created, so two rows
 * in one file that share a reference number both get added instead of the
 * second one overwriting the first.
 */
async function findExistingStudent(row: ParsedStudentRow, handledIds: string[]) {
  const notHandled = handledIds.length > 0 ? { id: { notIn: handledIds } } : {};

  if (row.email) {
    return prisma.student.findFirst({
      where: { user: { email: row.email }, ...notHandled },
      select: { id: true, userId: true, universityId: true, user: { select: { email: true, fullName: true } } },
    });
  }

  if (row.universityId) {
    const matches = await prisma.student.findMany({
      where: { universityId: row.universityId, ...notHandled },
      select: { id: true, userId: true, universityId: true, user: { select: { email: true, fullName: true } } },
      take: 2,
    });

    if (matches.length > 1) {
      throw new Error(
        "الرقم المرجعي مشترك بين أكثر من طالب، اكتب البريد الإلكتروني عشان تحدد الطالب.",
      );
    }
    return matches[0] ?? null;
  }

  return null;
}

type UpsertOutcome = { action: "created" | "updated"; studentId: string };

async function upsertStudent(
  row: ParsedStudentRow,
  actorId: string,
  handledIds: string[] = [],
): Promise<UpsertOutcome> {
  const department = await resolveDepartment(row.department);
  const specialization = await resolveSpecializationForImport(department.id, row.specialization);

  const existing = await findExistingStudent(row, handledIds);

  if (existing) {
    await assertUniqueEmail(row.email, existing.id);

    const passwordHash =
      row.password.length > 0 ? await bcrypt.hash(row.password, BCRYPT_ROUNDS) : null;

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: existing.userId },
        data: {
          fullName: row.fullName,
          // A blank cell must never wipe a real address with a placeholder.
          ...(row.email ? { email: row.email } : {}),
          ...(passwordHash ? { passwordHash } : {}),
        },
      });

      await tx.student.update({
        where: { id: existing.id },
        data: {
          universityId: row.universityId || existing.universityId,
          // A blank cell keeps the serial already on record, matching how the
          // university id behaves: an empty upload column is not a request to
          // erase a value someone typed by hand.
          ...(row.serial ? { serial: row.serial } : {}),
          phone: row.phone || null,
          academicYear: row.academicYear,
          departmentId: department.id,
          specializationId: specialization?.id ?? null,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: actorId,
          action: "student.update",
          entity: "Student",
          entityId: existing.id,
          metadata: {
            fullName: row.fullName,
            email: row.email,
            universityId: row.universityId,
            serial: row.serial || null,
            specializationId: specialization?.id ?? null,
            source: "excel",
          },
        },
      });
    });

    return { action: "updated", studentId: existing.id };
  }

  const identity = fillMissingIdentity(row);
  const passwordHash = await bcrypt.hash(row.password || studentDefaultPassword, BCRYPT_ROUNDS);

  const created = await prisma.$transaction(async (tx) => {
    const student = await tx.student.create({
      data: {
        universityId: identity.universityId,
        serial: row.serial || null,
        phone: row.phone || null,
        academicYear: row.academicYear,
        department: { connect: { id: department.id } },
        specialization: specialization ? { connect: { id: specialization.id } } : undefined,
        user: {
          create: {
            email: identity.email,
            fullName: row.fullName,
            passwordHash,
            role: UserRole.STUDENT,
          },
        },
      },
      select: { id: true },
    });

    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "student.create",
        entity: "Student",
        entityId: student.id,
        metadata: {
          fullName: row.fullName,
          email: identity.email,
          universityId: identity.universityId,
          serial: row.serial || null,
          specializationId: specialization?.id ?? null,
          source: "excel",
        },
      },
    });

    return student;
  });

  return { action: "created", studentId: created.id };
}

export function parseStudentExcel(buffer: Buffer): ParsedStudentRow[] {
  const result = parseRows(buffer);
  result.rows.forEach(validateRow);
  return result.rows;
}

export async function importStudentsFromExcel(
  buffer: Buffer,
  actorId: string,
): Promise<StudentImportResult> {
  const { rows, errors } = parseRows(buffer);
  const result: StudentImportResult = { created: 0, updated: 0, errors };
  const handledIds: string[] = [];

  for (const row of rows) {
    try {
      validateRow(row);
      const outcome = await upsertStudent(row, actorId, handledIds);
      handledIds.push(outcome.studentId);
      if (outcome.action === "created") result.created += 1;
      else result.updated += 1;
    } catch (error) {
      result.errors.push({ row: row.line, message: error instanceof Error ? error.message : "خطأ غير معروف." });
    }
  }

  return result;
}

export async function importStudentsForSubjectFromExcel(
  buffer: Buffer,
  subjectId: string,
  actorId: string,
): Promise<SubjectImportResult> {
  const subject = await prisma.subject.findUnique({
    where: { id: subjectId },
    select: { id: true, code: true, name: true },
  });

  if (!subject) throw new Error("المادة غير موجودة.");

  const { rows, errors } = parseRows(buffer);
  const result: SubjectImportResult = {
    created: 0,
    updated: 0,
    enrolled: 0,
    alreadyEnrolled: 0,
    subjectCode: subject.code,
    errors,
  };
  const handledIds: string[] = [];

  for (const row of rows) {
    try {
      validateRow(row);

      const outcome = await upsertStudent(row, actorId, handledIds);
      handledIds.push(outcome.studentId);
      if (outcome.action === "created") result.created += 1;
      else result.updated += 1;

      const already = await prisma.enrollment.findUnique({
        where: { studentId_subjectId: { studentId: outcome.studentId, subjectId } },
        select: { status: true },
      });

      await prisma.enrollment.upsert({
        where: { studentId_subjectId: { studentId: outcome.studentId, subjectId } },
        create: { studentId: outcome.studentId, subjectId, status: "ACTIVE" },
        update: { status: "ACTIVE" },
      });

      if (already) result.alreadyEnrolled += 1;
      else result.enrolled += 1;
    } catch (error) {
      result.errors.push({ row: row.line, message: error instanceof Error ? error.message : "خطأ غير معروف." });
    }
  }

  if (rows.length > 0) {
    await prisma.auditLog.create({
      data: {
        userId: actorId,
        action: "subject.update",
        entity: "Subject",
        entityId: subjectId,
        metadata: {
          enrollment: "excel-import",
          created: result.created,
          updated: result.updated,
          enrolled: result.enrolled,
          code: subject.code,
          rows: rows.length,
        },
      },
    });
  }

  return result;
}
