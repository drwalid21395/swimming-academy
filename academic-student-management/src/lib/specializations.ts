import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { splitTemplateOptionLabel } from "@/lib/student-excel";

const codePattern = /^[A-Za-z0-9_\-\/]+$/;

export const specializationFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "اسم التخصص مطلوب (حرفان على الأقل).")
    .max(80, "اسم التخصص طويل جداً."),
  code: z
    .string()
    .trim()
    .min(2, "كود التخصص مطلوب.")
    .max(20, "كود التخصص طويل جداً.")
    .regex(codePattern, "كود التخصص يقبل حروفاً إنجليزية وأرقاماً فقط."),
  departmentId: z.string().min(1, "القسم مطلوب."),
  description: z
    .string()
    .trim()
    .max(200, "الوصف طويل جداً.")
    .optional()
    .or(z.literal("")),
});

export type SpecializationInput = z.infer<typeof specializationFormSchema>;

export type SpecializationListItem = {
  id: string;
  name: string;
  code: string;
  description: string | null;
  departmentId: string;
  departmentName: string;
  departmentCode: string;
  studentsCount: number;
};

export type SpecializationOption = {
  id: string;
  name: string;
  code: string;
  departmentId: string;
  departmentName: string;
};

export async function listSpecializations(): Promise<SpecializationListItem[]> {
  const rows = await prisma.specialization.findMany({
    orderBy: [{ department: { name: "asc" } }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      code: true,
      description: true,
      departmentId: true,
      department: { select: { name: true, code: true } },
      _count: { select: { students: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    code: row.code,
    description: row.description,
    departmentId: row.departmentId,
    departmentName: row.department.name,
    departmentCode: row.department.code,
    studentsCount: row._count.students,
  }));
}

/** Specialization options for dropdowns, optionally narrowed to one department. */
export async function getSpecializationOptions(
  departmentId?: string,
): Promise<SpecializationOption[]> {
  const rows = await prisma.specialization.findMany({
    where: departmentId ? { departmentId } : undefined,
    orderBy: [{ department: { name: "asc" } }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      code: true,
      departmentId: true,
      department: { select: { name: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    code: row.code,
    departmentId: row.departmentId,
    departmentName: row.department.name,
  }));
}

export type SpecializationEditData = {
  id: string;
  name: string;
  code: string;
  description: string | null;
  departmentId: string;
};

export async function getSpecializationForEdit(
  specializationId: string,
): Promise<SpecializationEditData | null> {
  return prisma.specialization.findUnique({
    where: { id: specializationId },
    select: { id: true, name: true, code: true, description: true, departmentId: true },
  });
}

async function assertUnique(
  departmentId: string,
  name: string,
  code: string,
  excludeId?: string,
) {
  const clash = await prisma.specialization.findFirst({
    where: {
      departmentId,
      OR: [{ name: { equals: name, mode: "insensitive" as const } }, { code }],
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true, name: true, code: true },
  });

  if (!clash) return;
  if (clash.name.toLowerCase() === name.toLowerCase()) {
    throw new Error("يوجد تخصص بنفس الاسم في هذا القسم.");
  }
  throw new Error("كود التخصص مستخدم بالفعل في هذا القسم.");
}

async function assertDepartment(departmentId: string) {
  const department = await prisma.department.findUnique({
    where: { id: departmentId },
    select: { id: true, name: true },
  });
  if (!department) throw new Error("القسم غير موجود.");
  return department;
}

export async function createSpecialization(input: SpecializationInput, actorId: string) {
  const name = input.name.trim();
  const code = input.code.trim().toUpperCase();
  const description = input.description?.trim() ? input.description.trim() : null;

  await assertDepartment(input.departmentId);
  await assertUnique(input.departmentId, name, code);

  return prisma.$transaction(async (tx) => {
    const created = await tx.specialization.create({
      data: { name, code, description, departmentId: input.departmentId },
      select: { id: true },
    });

    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "specialization.create",
        entity: "Specialization",
        entityId: created.id,
        metadata: { name, code, departmentId: input.departmentId },
      },
    });

    return created;
  });
}

export async function updateSpecialization(
  specializationId: string,
  input: SpecializationInput,
  actorId: string,
) {
  const existing = await prisma.specialization.findUnique({
    where: { id: specializationId },
    select: { id: true },
  });
  if (!existing) throw new Error("التخصص غير موجود.");

  const name = input.name.trim();
  const code = input.code.trim().toUpperCase();
  const description = input.description?.trim() ? input.description.trim() : null;

  await assertDepartment(input.departmentId);
  await assertUnique(input.departmentId, name, code, specializationId);

  return prisma.$transaction(async (tx) => {
    await tx.specialization.update({
      where: { id: specializationId },
      data: { name, code, description, departmentId: input.departmentId },
    });

    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "specialization.update",
        entity: "Specialization",
        entityId: specializationId,
        metadata: { name, code, departmentId: input.departmentId },
      },
    });
  });
}

export async function deleteSpecialization(specializationId: string, actorId: string) {
  const existing = await prisma.specialization.findUnique({
    where: { id: specializationId },
    select: { id: true, name: true, _count: { select: { students: true } } },
  });
  if (!existing) throw new Error("التخصص غير موجود.");

  if (existing._count.students > 0) {
    throw new Error(
      `لا يمكن حذف التخصص "${existing.name}" لأنه مرتبط بـ ${existing._count.students} طالب. انقل الطلاب إلى تخصص آخر أولاً.`,
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "specialization.delete",
        entity: "Specialization",
        entityId: specializationId,
        metadata: { name: existing.name },
      },
    });

    await tx.specialization.delete({ where: { id: specializationId } });
  });
}

/** Resolves an Excel/CSV specialization label to an id inside a department. */
export async function resolveSpecializationForImport(
  departmentId: string,
  value: string,
) {
  const trimmed = value.trim();
  if (!trimmed) return null;

  // The template writes "CODE — NAME", but a cell may hold just a code or just
  // a name, so every part of the label is offered as a lookup candidate.
  const candidates = splitTemplateOptionLabel(trimmed);

  const specialization = await prisma.specialization.findFirst({
    where: {
      departmentId,
      OR: [
        { code: { in: candidates, mode: "insensitive" as const } },
        { name: { in: candidates, mode: "insensitive" as const } },
      ],
    },
    select: { id: true },
  });

  if (!specialization) {
    throw new Error(
      `التخصص غير موجود في القسم: ${trimmed}. أضفه من صفحة التخصصات أولاً أو اترك العمود فارغاً.`,
    );
  }

  return specialization;
}
