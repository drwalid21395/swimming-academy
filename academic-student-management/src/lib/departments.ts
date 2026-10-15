import { z } from "zod";

import { prisma } from "@/lib/prisma";

export const departmentFormSchema = z.object({
  name: z.string().trim().min(3, "اسم القسم مطلوب (3 أحرف على الأقل).").max(120),
  code: z
    .string()
    .trim()
    .min(2, "كود القسم مطلوب.")
    .max(20, "كود القسم طويل جداً.")
    .regex(/^[A-Za-z0-9\-_]+$/, "كود القسم يقبل حروفاً إنجليزية وأرقاماً فقط."),
  description: z.string().trim().max(500).optional().or(z.literal("")),
  headId: z.string().trim().optional().or(z.literal("")),
});

export type DepartmentFormValues = z.infer<typeof departmentFormSchema>;

export type DepartmentListItem = {
  id: string;
  name: string;
  code: string;
  description: string | null;
  head: { id: string; fullName: string; email: string } | null;
  professorsCount: number;
  subjectsCount: number;
  studentsCount: number;
};

export async function listDepartments(): Promise<DepartmentListItem[]> {
  const departments = await prisma.department.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      code: true,
      description: true,
      head: { select: { id: true, user: { select: { fullName: true, email: true } } } },
      _count: { select: { professors: true, subjects: true, students: true } },
    },
  });

  return departments.map((department) => ({
    id: department.id,
    name: department.name,
    code: department.code,
    description: department.description,
    head: department.head
      ? {
          id: department.head.id,
          fullName: department.head.user.fullName,
          email: department.head.user.email,
        }
      : null,
    professorsCount: department._count.professors,
    subjectsCount: department._count.subjects,
    studentsCount: department._count.students,
  }));
}

async function assertUniqueName(name: string, excludeId?: string) {
  const clash = await prisma.department.findFirst({
    where: { name, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true },
  });

  if (clash) throw new Error("يوجد قسم بهذا الاسم بالفعل.");
}

async function assertUniqueCode(code: string, excludeId?: string) {
  const clash = await prisma.department.findFirst({
    where: { code, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true },
  });

  if (clash) throw new Error("كود القسم مستخدم بالفعل.");
}

async function assertHeadInDepartment(headId: string, departmentId: string) {
  const professor = await prisma.professor.findUnique({
    where: { id: headId },
    select: { id: true, departmentId: true, user: { select: { fullName: true } } },
  });

  if (!professor) throw new Error("عضو هيئة التدريس غير موجود.");
  if (professor.departmentId !== departmentId) {
    throw new Error("رئيس القسم يجب أن يكون من أعضاء نفس القسم.");
  }

  return professor;
}

function normalizeCode(code: string) {
  return code.trim().toUpperCase();
}

export async function createDepartment(input: DepartmentFormValues, actorId: string) {
  const name = input.name.trim();
  const code = normalizeCode(input.code);
  await assertUniqueName(name);
  await assertUniqueCode(code);
  const headId = input.headId?.trim() || null;

  const department = await prisma.$transaction(async (tx) => {
    const created = await tx.department.create({
      data: {
        name,
        code,
        description: input.description?.trim() ? input.description.trim() : null,
      },
      select: { id: true, name: true, code: true },
    });

    if (headId) {
      await assertHeadInDepartment(headId, created.id);
      await tx.department.update({
        where: { id: created.id },
        data: { head: { connect: { id: headId } } },
      });
    }

    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "department.create",
        entity: "Department",
        entityId: created.id,
        metadata: { name: created.name, code: created.code, headId },
      },
    });

    return created;
  });

  return department;
}

export async function updateDepartment(
  departmentId: string,
  input: DepartmentFormValues,
  actorId: string,
) {
  const existing = await prisma.department.findUnique({
    where: { id: departmentId },
    select: { id: true, name: true, code: true },
  });

  if (!existing) throw new Error("القسم غير موجود.");

  const name = input.name.trim();
  const code = normalizeCode(input.code);
  await assertUniqueName(name, departmentId);
  await assertUniqueCode(code, departmentId);
  const headId = input.headId?.trim() || null;

  await prisma.$transaction(async (tx) => {
    if (headId) await assertHeadInDepartment(headId, departmentId);

    await tx.department.update({
      where: { id: departmentId },
      data: {
        name,
        code,
        description: input.description?.trim() ? input.description.trim() : null,
        head: headId ? { connect: { id: headId } } : { disconnect: true },
      },
    });

    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "department.update",
        entity: "Department",
        entityId: departmentId,
        metadata: { name, code, headId },
      },
    });
  });

  return existing;
}

export async function deleteDepartment(departmentId: string, actorId: string) {
  const department = await prisma.department.findUnique({
    where: { id: departmentId },
    select: {
      id: true,
      name: true,
      code: true,
      _count: { select: { subjects: true, professors: true, students: true } },
    },
  });

  if (!department) throw new Error("القسم غير موجود.");

  if (department._count.subjects > 0) {
    throw new Error("لا يمكن حذف قسم يحتوي على مواد دراسية.");
  }
  if (department._count.professors > 0) {
    throw new Error("لا يمكن حذف قسم يحتوي على أعضاء هيئة تدريس.");
  }
  if (department._count.students > 0) {
    throw new Error("لا يمكن حذف قسم يحتوي على طلاب.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "department.delete",
        entity: "Department",
        entityId: departmentId,
        metadata: { name: department.name, code: department.code },
      },
    });

    await tx.department.delete({ where: { id: departmentId } });
  });
}