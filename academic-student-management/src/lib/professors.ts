import { UserRole } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import {
  isProfessorPermissionKey,
  professorPermissionLabel,
  type ProfessorPermissionKey,
} from "@/lib/professor-permissions";

const BCRYPT_ROUNDS = 10;

export const professorFormSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(4, "الاسم الكامل مطلوب (4 أحرف على الأقل).")
    .max(120, "الاسم طويل جداً."),
  email: z.string().trim().toLowerCase().email("صيغة البريد الإلكتروني غير صحيحة."),
  employeeCode: z
    .string()
    .trim()
    .min(2, "الرقم الوظيفي مطلوب.")
    .max(30, "الرقم الوظيفي طويل جداً."),
  phone: z
    .string()
    .trim()
    .regex(/^[0-9+\-\s]{6,20}$/, "رقم الهاتف غير صالح.")
    .optional()
    .or(z.literal("")),
  departmentId: z.string().min(1, "القسم مطلوب."),
  password: z.string().min(8, "كلمة المرور 8 أحرف على الأقل.").optional().or(z.literal("")),
  isActive: z.enum(["1", "0"]),
  kind: z.enum(["PROFESSOR", "ASSISTANT"]).default("PROFESSOR"),
  /** Required when `kind` is `ASSISTANT`; ignored otherwise. */
  supervisorId: z.string().default(""),
  subjectIds: z.array(z.string()),
  permissionKeys: z.array(z.string()),
});

export type ProfessorFormValues = z.infer<typeof professorFormSchema>;
export type ProfessorInput = ProfessorFormValues;

export type ProfessorEditData = {
  id: string;
  fullName: string;
  email: string;
  employeeCode: string;
  phone: string | null;
  departmentId: string;
  isActive: boolean;
  kind: "PROFESSOR" | "ASSISTANT";
  supervisorId: string | null;
  supervisorName: string | null;
  subjectIds: string[];
  permissionKeys: string[];
};

function toPermissionKeys(values: string[]): ProfessorPermissionKey[] {
  return [...new Set(values.filter(isProfessorPermissionKey))];
}

async function assertUniqueIdentity(
  email: string,
  employeeCode: string,
  options: { userId?: string; professorId?: string } = {},
) {
  const emailOwner = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (emailOwner && emailOwner.id !== options.userId) {
    throw new Error("اسم المستخدم (البريد الإلكتروني) مستخدم بالفعل لحساب آخر.");
  }

  const codeOwner = await prisma.professor.findUnique({
    where: { employeeCode },
    select: { id: true },
  });
  if (codeOwner && codeOwner.id !== options.professorId) {
    throw new Error("الرقم الوظيفي مستخدم بالفعل لعضو هيئة تدريس آخر.");
  }
}

async function assertReferences(departmentId: string, subjectIds: string[]) {
  const [department, subjects] = await Promise.all([
    prisma.department.findUnique({ where: { id: departmentId }, select: { id: true } }),
    prisma.subject.findMany({ where: { id: { in: subjectIds } }, select: { id: true } }),
  ]);

  if (!department) throw new Error("القسم المحدد غير موجود.");
  if (subjects.length !== subjectIds.length) throw new Error("إحدى المواد المحددة غير موجودة.");
}

/**
 * Validates the supervisor link of an assistant and returns the subjects it may
 * hold. An assistant without a supervisor, or one aimed at itself, is refused:
 * without a supervisor there is nothing to cap its scope against.
 */
async function resolveAssistantSupervisor(supervisorId: string, selfId?: string) {
  const supervisor = await prisma.professor.findUnique({
    where: { id: supervisorId },
    select: {
      id: true,
      kind: true,
      departmentId: true,
      user: { select: { fullName: true } },
      subjects: { select: { subjectId: true } },
    },
  });

  if (!supervisor) throw new Error("الدكتور المشرف غير موجود.");
  if (supervisor.id === selfId) throw new Error("لا يمكن أن يكون الدكتور مشرفاً على نفسه.");
  if (supervisor.kind !== "PROFESSOR") {
    throw new Error("يجب أن يكون المشرف عضو هيئة تدريس رئيسياً وليس عضو معاونة.");
  }

  return {
    supervisorId: supervisor.id,
    supervisorName: supervisor.user.fullName,
    departmentId: supervisor.departmentId,
    subjectIds: supervisor.subjects.map((link) => link.subjectId),
  };
}

/**
 * Creates the login account, the professor record, the subject scope and the
 * granted keys at once. `kind` decides whether the account is main teaching
 * staff or an assistant, and an assistant additionally inherits its supervisor's
 * department and is capped by the supervisor's subjects.
 */
export async function createProfessorAccount(
  input: ProfessorInput,
  actorId: string,
  options: { primarySubjectId?: string } = {},
) {
  const email = input.email.trim().toLowerCase();
  const employeeCode = input.employeeCode.trim();
  const password = input.password?.trim() ?? "";
  const isAssistant = input.kind === "ASSISTANT";

  if (password.length < 8) {
    throw new Error(
      isAssistant
        ? "كلمة المرور مطلوبة عند إضافة عضو هيئة معاونة (8 أحرف على الأقل)."
        : "كلمة المرور مطلوبة عند إضافة دكتور جديد (8 أحرف على الأقل).",
    );
  }

  const supervisor = isAssistant
    ? await resolveAssistantSupervisor(input.supervisorId ?? "")
    : null;

  // An assistant is limited to the supervisor's subjects, so the submitted list is
  // intersected with them instead of being trusted or rejected outright: leaving
  // every box ticked on a shared form should not fail the save.
  const requestedSubjects = [...new Set(input.subjectIds)].filter(Boolean);
  // Selecting no subject grants no subject. Inheriting the supervisor's whole scope
  // would silently widen access, so an empty selection stays empty until the
  // administrator assigns something.
  const effectiveSubjectIds = supervisor
    ? requestedSubjects.filter((id) => supervisor.subjectIds.includes(id))
    : requestedSubjects;

  const permissionKeys = toPermissionKeys(input.permissionKeys);

  await assertUniqueIdentity(email, employeeCode);
  await assertReferences(supervisor?.departmentId ?? input.departmentId, effectiveSubjectIds);

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const primarySubjectId =
    options.primarySubjectId && effectiveSubjectIds.includes(options.primarySubjectId)
      ? options.primarySubjectId
      : (effectiveSubjectIds[0] ?? null);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        fullName: input.fullName.trim(),
        passwordHash,
        role: UserRole.PROFESSOR,
        isActive: input.isActive === "1",
      },
      select: { id: true, fullName: true, email: true },
    });

    const professor = await tx.professor.create({
      data: {
        userId: user.id,
        employeeCode,
        phone: input.phone?.trim() ? input.phone.trim() : null,
        departmentId: supervisor?.departmentId ?? input.departmentId,
        kind: isAssistant ? "ASSISTANT" : "PROFESSOR",
        supervisorId: supervisor?.supervisorId ?? null,
      },
      select: { id: true },
    });

    for (const subjectId of effectiveSubjectIds) {
      await tx.subjectProfessor.create({
        data: { subjectId, professorId: professor.id, isPrimary: subjectId === primarySubjectId },
        select: { professorId: true },
      });
    }

    for (const permission of permissionKeys) {
      await tx.professorPermission.create({
        data: { professorId: professor.id, permission, grantedById: actorId },
        select: { id: true },
      });
    }

    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: isAssistant ? "professor.assistant.create" : "professor.create",
        entity: "Professor",
        entityId: professor.id,
        metadata: {
          fullName: user.fullName,
          email: user.email,
          employeeCode,
          kind: isAssistant ? "ASSISTANT" : "PROFESSOR",
          supervisor: supervisor?.supervisorName ?? null,
          subjects: effectiveSubjectIds.length,
          permissions: permissionKeys.map(professorPermissionLabel),
        },
      },
    });

    return {
      id: professor.id,
      userId: user.id,
      fullName: user.fullName,
      email: user.email,
      supervisorName: supervisor?.supervisorName ?? null,
    };
  });
}

/** Applies account, subject scope and permission changes in a single transaction. */
export async function updateProfessorAccount(
  professorId: string,
  input: ProfessorInput,
  actorId: string,
  options: { primarySubjectId?: string } = {},
) {
  const email = input.email.trim().toLowerCase();
  const employeeCode = input.employeeCode.trim();
  const password = input.password?.trim() ?? "";

  const existing = await prisma.professor.findUnique({
    where: { id: professorId },
    select: {
      id: true,
      userId: true,
      employeeCode: true,
      kind: true,
      supervisorId: true,
      departmentId: true,
      subjects: { select: { subjectId: true, isPrimary: true } },
      permissions: { select: { id: true, permission: true } },
      user: { select: { fullName: true, email: true, isActive: true } },
    },
  });

  if (!existing) throw new Error("عضو هيئة التدريس غير موجود.");

  if (password && password.length < 8) {
    throw new Error("كلمة المرور 8 أحرف على الأقل.");
  }

  // The kind of an existing member is fixed: turning a professor into an
  // assistant (or the reverse) would silently hand a live account a different
  // scope, so the administrator has to delete and recreate instead.
  const isAssistant = existing.kind === "ASSISTANT";

  const supervisor = isAssistant
    ? await resolveAssistantSupervisor(input.supervisorId || existing.supervisorId || "", existing.id)
    : null;

  const requestedSubjects = [...new Set(input.subjectIds)].filter(Boolean);
  const subjectIds = supervisor
    ? requestedSubjects.filter((id) => supervisor.subjectIds.includes(id))
    : requestedSubjects;

  const permissionKeys = toPermissionKeys(input.permissionKeys);

  await assertUniqueIdentity(email, employeeCode, {
    userId: existing.userId,
    professorId: existing.id,
  });
  await assertReferences(supervisor?.departmentId ?? input.departmentId, subjectIds);

  const passwordHash = password ? await bcrypt.hash(password, BCRYPT_ROUNDS) : null;
  const primarySubjectId =
    options.primarySubjectId && subjectIds.includes(options.primarySubjectId)
      ? options.primarySubjectId
      : (subjectIds[0] ?? null);

  const currentSubjects = new Set(existing.subjects.map((link) => link.subjectId));
  const nextSubjects = new Set(subjectIds);
  const toAdd = subjectIds.filter((id) => !currentSubjects.has(id));
  const toRemove = [...currentSubjects].filter((id) => !nextSubjects.has(id));
  const toUpdatePrimary = subjectIds.filter(
    (id) => currentSubjects.has(id) && existing.subjects.find((link) => link.subjectId === id)?.isPrimary !== (id === primarySubjectId),
  );

  const currentPermissions = new Set(existing.permissions.map((grant) => grant.permission));
  const nextPermissions = new Set(permissionKeys);
  const toGrant = permissionKeys.filter((key) => !currentPermissions.has(key));
  const toRevoke = existing.permissions
    .filter((grant) => isProfessorPermissionKey(grant.permission) && !nextPermissions.has(grant.permission))
    .map((grant) => grant.id);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: existing.userId },
      data: {
        fullName: input.fullName.trim(),
        email,
        isActive: input.isActive === "1",
        ...(passwordHash ? { passwordHash } : {}),
      },
      select: { id: true },
    });

    await tx.professor.update({
      where: { id: existing.id },
      data: {
        employeeCode,
        phone: input.phone?.trim() ? input.phone.trim() : null,
        departmentId: supervisor?.departmentId ?? input.departmentId,
        supervisorId: supervisor?.supervisorId ?? null,
      },
      select: { id: true },
    });

    if (toRemove.length > 0) {
      await tx.subjectProfessor.deleteMany({
        where: { professorId: existing.id, subjectId: { in: toRemove } },
      });
    }

    for (const subjectId of toAdd) {
      await tx.subjectProfessor.create({
        data: { subjectId, professorId: existing.id, isPrimary: subjectId === primarySubjectId },
        select: { professorId: true },
      });
    }

    for (const subjectId of toUpdatePrimary) {
      await tx.subjectProfessor.update({
        where: { subjectId_professorId: { subjectId, professorId: existing.id } },
        data: { isPrimary: subjectId === primarySubjectId },
        select: { professorId: true },
      });
    }

    if (toRevoke.length > 0) {
      await tx.professorPermission.deleteMany({ where: { id: { in: toRevoke } } });
    }

    for (const permission of toGrant) {
      await tx.professorPermission.create({
        data: { professorId: existing.id, permission, grantedById: actorId },
        select: { id: true },
      });
    }

    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "professor.update",
        entity: "Professor",
        entityId: existing.id,
        metadata: {
          fullName: input.fullName.trim(),
          email,
          employeeCode,
          kind: existing.kind,
          supervisor: supervisor?.supervisorName ?? null,
          subjectsAdded: toAdd.length,
          subjectsRemoved: toRemove.length,
          granted: toGrant.map(professorPermissionLabel),
          revoked: toRevoke.length,
          passwordChanged: Boolean(passwordHash),
          isActive: input.isActive === "1",
        },
      },
    });
  });

  return {
    id: existing.id,
    subjectsAdded: toAdd.length,
    subjectsRemoved: toRemove.length,
    granted: toGrant.length,
    revoked: toRevoke.length,
    passwordChanged: Boolean(passwordHash),
  };
}

export async function loadProfessorEditData(professorId: string): Promise<ProfessorEditData | null> {
  const professor = await prisma.professor.findUnique({
    where: { id: professorId },
    select: {
      id: true,
      employeeCode: true,
      phone: true,
      departmentId: true,
      kind: true,
      supervisorId: true,
      supervisor: { select: { user: { select: { fullName: true } } } },
      user: { select: { fullName: true, email: true, isActive: true } },
      subjects: { select: { subjectId: true } },
      permissions: { select: { permission: true } },
    },
  });

  if (!professor) return null;

  return {
    id: professor.id,
    fullName: professor.user.fullName,
    email: professor.user.email,
    employeeCode: professor.employeeCode,
    phone: professor.phone,
    departmentId: professor.departmentId,
    isActive: professor.user.isActive,
    kind: professor.kind,
    supervisorId: professor.supervisorId,
    supervisorName: professor.supervisor?.user.fullName ?? null,
    subjectIds: professor.subjects.map((link) => link.subjectId),
    permissionKeys: professor.permissions
      .map((grant) => grant.permission)
      .filter(isProfessorPermissionKey),
  };
}

/**
 * Deletes a professor account. Refuses when the member already produced records
 * (attendance, exams, questions, announcements) so no history is ever lost.
 */
export async function deleteProfessorAccount(professorId: string, actorId: string) {
  const professor = await prisma.professor.findUnique({
    where: { id: professorId },
    select: {
      id: true,
      employeeCode: true,
      userId: true,
      user: { select: { fullName: true, email: true } },
      _count: { select: { assistants: true } },
    },
  });

  if (!professor) throw new Error("عضو هيئة التدريس غير موجود.");
  if (professor.userId === actorId) throw new Error("لا يمكنك حذف حسابك الحالي.");

  // Deleting a supervisor would orphan their assistants and leave them with a
  // missing ceiling on their subject scope.
  if (professor._count.assistants > 0) {
    throw new Error(
      `لا يمكن حذف الدكتور لأنه مشرف على ${professor._count.assistants} من أعضاء هيئة المعاونة. انقلهم إلى دكتور آخر أولاً.`,
    );
  }

  const [attendance, exams, questions, announcements, files] = await Promise.all([
    prisma.attendanceSession.count({ where: { createdById: professorId } }),
    prisma.exam.count({ where: { createdById: professorId } }),
    prisma.question.count({ where: { createdById: professorId } }),
    prisma.announcement.count({ where: { authorId: professor.userId } }),
    prisma.file.count({ where: { uploadedById: professor.userId } }),
  ]);

  const blockers = [
    attendance > 0 ? `${attendance} سجل حضور` : null,
    exams > 0 ? `${exams} امتحان` : null,
    questions > 0 ? `${questions} سؤال` : null,
    announcements > 0 ? `${announcements} إعلان` : null,
    files > 0 ? `${files} ملف` : null,
  ].filter(Boolean) as string[];

  if (blockers.length > 0) {
    throw new Error(
      `لا يمكن الحذف لوجود سجلات مرتبطة بالحساب (${blockers.join("، ")}). يمكنك إيقاف الحساب بدلاً من ذلك.`,
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.delete({ where: { id: professor.userId }, select: { id: true } });

    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "professor.delete",
        entity: "Professor",
        entityId: professor.id,
        metadata: {
          fullName: professor.user.fullName,
          email: professor.user.email,
          employeeCode: professor.employeeCode,
        },
      },
    });
  });
}

/** Toggles whether a professor account may sign in. */
export async function setProfessorActive(
  professorId: string,
  isActive: boolean,
  actorId: string,
) {
  const professor = await prisma.professor.findUnique({
    where: { id: professorId },
    select: { id: true, userId: true, employeeCode: true, user: { select: { fullName: true, isActive: true } } },
  });

  if (!professor) throw new Error("عضو هيئة التدريس غير موجود.");
  if (professor.userId === actorId) throw new Error("لا يمكنك إيقاف حسابك الحالي.");

  if (professor.user.isActive === isActive) return { changed: false, isActive };

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: professor.userId },
      data: { isActive },
      select: { id: true },
    });

    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: isActive ? "professor.activate" : "professor.deactivate",
        entity: "Professor",
        entityId: professorId,
        metadata: { fullName: professor.user.fullName, employeeCode: professor.employeeCode },
      },
    });
  });

  return { changed: true, isActive };
}
