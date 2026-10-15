import { prisma } from "@/lib/prisma";
import type {
  ProfessorKind,
  ProfessorPermissionKey as PrismaProfessorPermissionKey,
} from "@prisma/client";

/**
 * Granular capabilities an administrator can grant to (or revoke from) a professor.
 *
 * The key list is intentionally fixed: an unknown key is rejected server-side, so a
 * crafted form cannot create capability records the UI does not know about.
 */
export const PROFESSOR_PERMISSION_CATALOG = [
  {
    key: "ATTENDANCE_RECORD",
    label: "تسجيل الحضور",
    description: "إنشاء المحاضرات وتسجيل حضور الطلاب وغيابهم في مواد الدكتور.",
  },
  {
    key: "SUBJECTS_MANAGE",
    label: "إدارة المواد",
    description: "الاطلاع على مواد الدكتور وتعديل بياناتها وحدود الحضور الخاصة بها.",
  },
  {
    key: "QUESTIONS_MANAGE",
    label: "إضافة الأسئلة",
    description: "إضافة أسئلة إلى بنك الأسئلة وتعديلها وحذفها ضمن المواد المسموحة.",
  },
  {
    key: "EXAMS_MANAGE",
    label: "إنشاء الامتحانات",
    description: "إنشاء امتحانات ضمن مواد الدكتور وتعديلها ونشرها وإغلاقها.",
  },
  {
    key: "RESULTS_VIEW",
    label: "مشاهدة النتائج",
    description: "الاطلاع على نتائج الطلاب ومحاولات الإجابة وتصحيحها.",
  },
  {
    key: "ANNOUNCEMENTS_PUBLISH",
    label: "نشر الإعلانات",
    description: "نشر إعلانات مواد الدكتور وتعديلها وتثبيتها.",
  },
] as const satisfies ReadonlyArray<{
  key: PrismaProfessorPermissionKey;
  label: string;
  description: string;
}>;

/**
 * What a new assistant starts with. Deliberately the narrowest useful set: an
 * assistant is usually hired to take the attendance sheet, so the administrator
 * only widens it from here when they mean to.
 */
export const ASSISTANT_DEFAULT_GRANTS: ProfessorPermissionKey[] = ["ATTENDANCE_RECORD"];

export type ProfessorPermissionKey = (typeof PROFESSOR_PERMISSION_CATALOG)[number]["key"];

export const PROFESSOR_PERMISSION_KEYS = PROFESSOR_PERMISSION_CATALOG.map(
  (entry) => entry.key,
) as ProfessorPermissionKey[];

const keySet = new Set<string>(PROFESSOR_PERMISSION_KEYS);

export function isProfessorPermissionKey(value: string): value is ProfessorPermissionKey {
  return keySet.has(value);
}

export function professorPermissionLabel(key: string) {
  return PROFESSOR_PERMISSION_CATALOG.find((entry) => entry.key === key)?.label ?? key;
}

export type ProfessorPermissionMatrixRow = {
  professorId: string;
  fullName: string;
  email: string;
  employeeCode: string;
  phone: string | null;
  departmentId: string;
  departmentName: string;
  isActive: boolean;
  /** `ASSISTANT` members appear in the same table but can only hold a subset of their supervisor's subjects. */
  kind: ProfessorKind;
  supervisorId: string | null;
  supervisorName: string | null;
  subjectIds: string[];
  subjectNames: string[];
  grants: {
    key: ProfessorPermissionKey;
    grantedAt: Date;
    grantedByName: string | null;
  }[];
};

export type ProfessorSupervisorOption = {
  professorId: string;
  fullName: string;
  employeeCode: string;
  departmentName: string;
  /** Subjects the assistant is allowed to be given, i.e. the supervisor's own scope. */
  subjectIds: string[];
};

export type ProfessorPermissionMatrix = {
  rows: ProfessorPermissionMatrixRow[];
  stats: {
    professors: number;
    assistants: number;
    subjects: number;
    grants: number;
    fullyLocked: number;
  };
  subjectOptions: { id: string; code: string; name: string; departmentName: string }[];
  /** Unfiltered by the search box, so an assistant form can always pick a supervisor. */
  supervisorOptions: ProfessorSupervisorOption[];
};

/** Every professor with their granted capabilities and the subjects they may act on. */
export async function listProfessorPermissionMatrix(
  query?: string,
): Promise<ProfessorPermissionMatrix> {
  const trimmed = query?.trim();

  const [professors, subjects] = await Promise.all([
    prisma.professor.findMany({
      orderBy: [{ user: { fullName: "asc" } }],
      select: {
        id: true,
        employeeCode: true,
        phone: true,
        departmentId: true,
        kind: true,
        supervisorId: true,
        department: { select: { name: true } },
        user: { select: { fullName: true, email: true, isActive: true } },
        supervisor: {
          select: {
            user: { select: { fullName: true } },
            subjects: { select: { subject: { select: { id: true, name: true } } } },
          },
        },
        permissions: {
          select: {
            permission: true,
            grantedAt: true,
            grantedBy: { select: { fullName: true } },
          },
          orderBy: { permission: "asc" },
        },
        subjects: {
          select: {
            isPrimary: true,
            subject: { select: { id: true, name: true } },
          },
          orderBy: { subject: { name: "asc" } },
        },
      },
    }),
    prisma.subject.findMany({
      orderBy: [{ name: "asc" }],
      select: {
        id: true,
        code: true,
        name: true,
        department: { select: { name: true } },
      },
    }),
  ]);

  // Built from the unfiltered list: the search box narrows the table, not the
  // set of professors an assistant may be attached to.
  const supervisorOptions: ProfessorSupervisorOption[] = professors
    .filter((professor) => professor.kind === "PROFESSOR")
    .map((professor) => ({
      professorId: professor.id,
      fullName: professor.user.fullName,
      employeeCode: professor.employeeCode,
      departmentName: professor.department.name,
      subjectIds: professor.subjects.map((link) => link.subject.id),
    }));

  // An assistant with no subjects of their own works across the supervisor's, so
  // the table shows the scope they can actually reach rather than only the rows
  // assigned to them directly.
  const scopedSubjects = (professor: (typeof professors)[number]) => {
    const own = professor.subjects;
    if (own.length > 0 || professor.kind !== "ASSISTANT") return own;
    return professor.supervisor?.subjects ?? [];
  };

  const rows = professors
    .filter((professor) => {
      if (!trimmed) return true;
      const haystack = [
        professor.user.fullName,
        professor.user.email,
        professor.employeeCode,
        professor.supervisor?.user.fullName ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(trimmed.toLowerCase());
    })
    .map((professor) => ({
      professorId: professor.id,
      fullName: professor.user.fullName,
      email: professor.user.email,
      employeeCode: professor.employeeCode,
      phone: professor.phone,
      departmentId: professor.departmentId,
      departmentName: professor.department.name,
      isActive: professor.user.isActive,
      kind: professor.kind,
      supervisorId: professor.supervisorId,
      supervisorName: professor.supervisor?.user.fullName ?? null,
      subjectIds: scopedSubjects(professor).map((link) => link.subject.id),
      subjectNames: scopedSubjects(professor).map((link) => link.subject.name),
      grants: professor.permissions
        .filter((grant) => isProfessorPermissionKey(grant.permission))
        .map((grant) => ({
          key: grant.permission as ProfessorPermissionKey,
          grantedAt: grant.grantedAt,
          grantedByName: grant.grantedBy?.fullName ?? null,
        })),
    }));

  return {
    rows,
    stats: {
      professors: rows.filter((row) => row.kind === "PROFESSOR").length,
      assistants: rows.filter((row) => row.kind === "ASSISTANT").length,
      subjects: new Set(rows.flatMap((row) => row.subjectIds)).size,
      grants: rows.reduce((sum, row) => sum + row.grants.length, 0),
      fullyLocked: rows.filter((row) => row.grants.length === 0).length,
    },
    subjectOptions: subjects.map((subject) => ({
      id: subject.id,
      code: subject.code,
      name: subject.name,
      departmentName: subject.department.name,
    })),
    supervisorOptions,
  };
}

/** Permission keys currently granted to the professor owning this user account. */
export async function loadProfessorGrants(userId: string): Promise<Set<ProfessorPermissionKey>> {
  const professor = await prisma.professor.findUnique({
    where: { userId },
    select: { permissions: { select: { permission: true } } },
  });

  return new Set(
    (professor?.permissions ?? [])
      .map((grant) => grant.permission)
      .filter(isProfessorPermissionKey),
  );
}

export async function hasProfessorGrant(
  userId: string,
  permission: ProfessorPermissionKey,
): Promise<boolean> {
  const count = await prisma.professorPermission.count({
    where: { permission, professor: { userId } },
  });
  return count > 0;
}

export async function setProfessorPermission(
  input: { professorId: string; permission: string; granted: boolean },
  actorId: string,
) {
  const { professorId, permission, granted } = input;

  if (!isProfessorPermissionKey(permission)) {
    throw new Error("نوع الصلاحية غير معروف.");
  }

  const professor = await prisma.professor.findUnique({
    where: { id: professorId },
    select: {
      id: true,
      employeeCode: true,
      user: { select: { fullName: true } },
      subjects: { select: { subjectId: true } },
    },
  });

  if (!professor) throw new Error("عضو هيئة التدريس غير موجود.");

  if (granted) {
    const existing = await prisma.professorPermission.findUnique({
      where: { professorId_permission: { professorId, permission } },
      select: { id: true },
    });

    if (!existing) {
      await prisma.$transaction(async (tx) => {
        await tx.professorPermission.create({
          data: { professorId, permission, grantedById: actorId },
          select: { id: true },
        });

        await tx.auditLog.create({
          data: {
            userId: actorId,
            action: "professor.permission.grant",
            entity: "ProfessorPermission",
            entityId: professorId,
            metadata: {
              professor: professor.user.fullName,
              employeeCode: professor.employeeCode,
              permission,
              permissionLabel: professorPermissionLabel(permission),
            },
          },
        });
      });
    }

    return { granted: true, alreadyAssigned: Boolean(existing) };
  }

  const existing = await prisma.professorPermission.findUnique({
    where: { professorId_permission: { professorId, permission } },
    select: { id: true },
  });

  if (existing) {
    await prisma.$transaction(async (tx) => {
      await tx.professorPermission.delete({ where: { id: existing.id } });

      await tx.auditLog.create({
        data: {
          userId: actorId,
          action: "professor.permission.revoke",
          entity: "ProfessorPermission",
          entityId: professorId,
          metadata: {
            professor: professor.user.fullName,
            employeeCode: professor.employeeCode,
            permission,
            permissionLabel: professorPermissionLabel(permission),
          },
        },
      });
    });
  }

  return { granted: false, alreadyAssigned: false };
}

/**
 * An assistant works alongside its supervisor, so the supervisor's own scope is
 * the hard ceiling: anything outside it is rejected here rather than silently
 * trimmed, so the administrator finds out their request was wrong.
 */
async function assertAssistantScope(
  professor: { id: string; kind: ProfessorKind; supervisorId: string | null },
  subjectIds: string[],
) {
  if (professor.kind !== "ASSISTANT") return;

  if (!professor.supervisorId) {
    throw new Error("عضو هيئة المعاونة غير مرتبط بدكتور مشرف. اربطه بدكتور أولاً.");
  }

  const supervisor = await prisma.professor.findUnique({
    where: { id: professor.supervisorId },
    select: { subjects: { select: { subjectId: true } } },
  });

  const allowed = new Set(supervisor?.subjects.map((link) => link.subjectId) ?? []);
  const forbidden = subjectIds.filter((id) => !allowed.has(id));

  if (forbidden.length > 0) {
    throw new Error(
      "لا يمكن إسناد مواد لا يدرّسها الدكتور المشرف. وسّع نطاق الدكتور المشرف أولاً.",
    );
  }
}

/** Replaces the subject scope of a professor. This is what limits every professor page. */
export async function setProfessorSubjectScope(
  professorId: string,
  subjectIds: string[],
  actorId: string,
) {
  const professor = await prisma.professor.findUnique({
    where: { id: professorId },
    select: {
      id: true,
      kind: true,
      supervisorId: true,
      employeeCode: true,
      user: { select: { fullName: true } },
      subjects: { select: { subjectId: true } },
    },
  });

  if (!professor) throw new Error("عضو هيئة التدريس غير موجود.");

  const uniqueIds = [...new Set(subjectIds)];
  const known = await prisma.subject.findMany({
    where: { id: { in: uniqueIds } },
    select: { id: true },
  });

  if (known.length !== uniqueIds.length) {
    throw new Error("إحدى المواد المحددة غير موجودة.");
  }

  await assertAssistantScope(professor, uniqueIds);

  const current = new Set(professor.subjects.map((link) => link.subjectId));
  const next = new Set(uniqueIds);

  const toAdd = uniqueIds.filter((id) => !current.has(id));
  const toRemove = [...current].filter((id) => !next.has(id));

  if (toAdd.length === 0 && toRemove.length === 0) {
    return { changed: false, added: 0, removed: 0 };
  }

  await prisma.$transaction(async (tx) => {
    if (toRemove.length > 0) {
      await tx.subjectProfessor.deleteMany({
        where: { professorId, subjectId: { in: toRemove } },
      });
    }

    for (const subjectId of toAdd) {
      await tx.subjectProfessor.create({
        data: { professorId, subjectId, isPrimary: false },
        select: { professorId: true },
      });
    }

    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "professor.scope.update",
        entity: "Professor",
        entityId: professorId,
        metadata: {
          professor: professor.user.fullName,
          employeeCode: professor.employeeCode,
          added: toAdd.length,
          removed: toRemove.length,
        },
      },
    });
  });

  return { changed: true, added: toAdd.length, removed: toRemove.length };
}
