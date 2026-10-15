import * as bcrypt from "bcryptjs";
import { z } from "zod";

import { prisma } from "@/lib/prisma";

export const termFormSchema = z
  .object({
    name: z.string().trim().min(2, "اسم الفصل لا يقل عن حرفين.").max(80, "اسم الفصل طويل جداً."),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "صيغة التاريخ يجب أن تكون YYYY-MM-DD."),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "صيغة التاريخ يجب أن تكون YYYY-MM-DD."),
  })
  .refine((values) => new Date(values.endDate) > new Date(values.startDate), {
    path: ["endDate"],
    message: "تاريخ النهاية يجب أن يكون بعد تاريخ البداية.",
  });

export type TermFormValues = z.infer<typeof termFormSchema>;

export const passwordFormSchema = z
  .object({
    currentPassword: z.string().min(1, "أدخل كلمة المرور الحالية."),
    newPassword: z.string().min(8, "كلمة المرور الجديدة لا تقل عن 8 أحرف."),
    confirmPassword: z.string().min(1, "أعد تأكيد كلمة المرور."),
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    path: ["confirmPassword"],
    message: "كلمتا المرور غير متطابقتين.",
  });

export type PasswordFormValues = z.infer<typeof passwordFormSchema>;

export type TermListItem = {
  id: string;
  name: string;
  startDate: Date;
  endDate: Date;
  isCurrent: boolean;
  subjectsCount: number;
  enrollmentsCount: number;
  createdAt: Date;
};

export type TermEditData = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
};

function toDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function toInputDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

export async function listTerms(): Promise<{ ok: true; data: TermListItem[] } | { ok: false; message: string }> {
  try {
    const rows = await prisma.academicTerm.findMany({
      orderBy: [{ isCurrent: "desc" }, { startDate: "desc" }],
      select: {
        id: true,
        name: true,
        startDate: true,
        endDate: true,
        isCurrent: true,
        createdAt: true,
        _count: { select: { subjects: true } },
        subjects: {
          select: { _count: { select: { enrollments: true } } },
        },
      },
    });

    return {
      ok: true,
      data: rows.map((row) => ({
        id: row.id,
        name: row.name,
        startDate: row.startDate,
        endDate: row.endDate,
        isCurrent: row.isCurrent,
        subjectsCount: row._count.subjects,
        enrollmentsCount: row.subjects.reduce((sum, subject) => sum + subject._count.enrollments, 0),
        createdAt: row.createdAt,
      })),
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "تعذر تحميل الفصول الدراسية.",
    };
  }
}

export async function getTermEditData(termId: string): Promise<TermEditData | null> {
  const term = await prisma.academicTerm.findUnique({
    where: { id: termId },
    select: { id: true, name: true, startDate: true, endDate: true, isCurrent: true },
  });

  if (!term) return null;

  return {
    id: term.id,
    name: term.name,
    startDate: toInputDate(term.startDate),
    endDate: toInputDate(term.endDate),
    isCurrent: term.isCurrent,
  };
}

export async function createTerm(values: TermFormValues, actorId: string) {
  const clash = await prisma.academicTerm.findFirst({
    where: { name: values.name },
    select: { id: true },
  });

  if (clash) throw new Error("يوجد فصل دراسي بنفس الاسم.");

  return prisma.$transaction(async (tx) => {
    const term = await tx.academicTerm.create({
      data: { name: values.name, startDate: toDate(values.startDate), endDate: toDate(values.endDate) },
      select: { id: true, name: true },
    });

    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "term.create",
        entity: "AcademicTerm",
        entityId: term.id,
        metadata: { name: term.name, startDate: values.startDate, endDate: values.endDate },
      },
    });

    return term;
  });
}

export async function updateTerm(termId: string, values: TermFormValues, actorId: string) {
  const existing = await prisma.academicTerm.findUnique({
    where: { id: termId },
    select: { id: true, name: true },
  });

  if (!existing) throw new Error("الفصل الدراسي غير موجود.");

  const clash = await prisma.academicTerm.findFirst({
    where: { name: values.name, NOT: { id: termId } },
    select: { id: true },
  });

  if (clash) throw new Error("يوجد فصل دراسي آخر بنفس الاسم.");

  return prisma.$transaction(async (tx) => {
    const term = await tx.academicTerm.update({
      where: { id: termId },
      data: { name: values.name, startDate: toDate(values.startDate), endDate: toDate(values.endDate) },
      select: { id: true, name: true },
    });

    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "term.update",
        entity: "AcademicTerm",
        entityId: term.id,
        metadata: { from: existing.name, to: term.name, startDate: values.startDate, endDate: values.endDate },
      },
    });

    return term;
  });
}

export async function setCurrentTerm(termId: string, actorId: string) {
  const existing = await prisma.academicTerm.findUnique({
    where: { id: termId },
    select: { id: true, name: true, isCurrent: true },
  });

  if (!existing) throw new Error("الفصل الدراسي غير موجود.");
  if (existing.isCurrent) throw new Error("هذا الفصل هو الفصل الدراسي الحالي بالفعل.");

  return prisma.$transaction(async (tx) => {
    await tx.academicTerm.updateMany({
      where: { isCurrent: true, NOT: { id: termId } },
      data: { isCurrent: false },
    });

    const term = await tx.academicTerm.update({
      where: { id: termId },
      data: { isCurrent: true },
      select: { id: true, name: true },
    });

    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "term.activate",
        entity: "AcademicTerm",
        entityId: term.id,
        metadata: { name: term.name },
      },
    });

    return term;
  });
}

export async function deleteTerm(termId: string, actorId: string) {
  const existing = await prisma.academicTerm.findUnique({
    where: { id: termId },
    select: { id: true, name: true, isCurrent: true, _count: { select: { subjects: true } } },
  });

  if (!existing) throw new Error("الفصل الدراسي غير موجود.");
  if (existing._count.subjects > 0) {
    throw new Error("لا يمكن حذف فصل مرتبط بمواد دراسية. انقل المواد إلى فصل آخر أولاً.");
  }

  return prisma.$transaction(async (tx) => {
    await tx.academicTerm.delete({ where: { id: termId }, select: { id: true } });

    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "term.delete",
        entity: "AcademicTerm",
        entityId: existing.id,
        metadata: { name: existing.name, wasCurrent: existing.isCurrent },
      },
    });
  });
}

export async function changePassword(userId: string, values: PasswordFormValues) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, passwordHash: true },
  });

  if (!user) throw new Error("المستخدم غير موجود.");

  const matches = await bcrypt.compare(values.currentPassword, user.passwordHash);
  if (!matches) throw new Error("كلمة المرور الحالية غير صحيحة.");

  if (values.currentPassword === values.newPassword) {
    throw new Error("كلمة المرور الجديدة يجب أن تختلف عن الحالية.");
  }

  const passwordHash = await bcrypt.hash(values.newPassword, 10);

  return prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { passwordHash }, select: { id: true } });

    await tx.auditLog.create({
      data: { userId, action: "auth.password.change", entity: "User", entityId: userId },
    });
  });
}
