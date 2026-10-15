import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import type { ProfessorKind } from "@prisma/client";

import { authOptions } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  isProfessorPermissionKey,
  professorPermissionLabel,
  type ProfessorPermissionKey,
} from "@/lib/professor-permissions";

export type ProfessorProfile = {
  id: string;
  userId: string;
  fullName: string;
  employeeCode: string;
  /** `ASSISTANT` members work under a supervisor and see a reduced portal. */
  kind: ProfessorKind;
  supervisorName: string | null;
  subjectIds: string[];
  /** Capabilities granted by an administrator. Anything missing is denied. */
  grants: ProfessorPermissionKey[];
  can: (permission: ProfessorPermissionKey) => boolean;
};

type SubjectScopeSource = {
  kind: ProfessorKind;
  subjects: { subjectId: string }[];
  supervisor: { subjects: { subjectId: string }[] } | null;
};

/**
 * The subjects a professor is allowed to act on.
 *
 * A main professor acts on exactly the subjects an administrator assigned. An
 * assistant is defined by the professor supervising them, and that supervisor's
 * subjects are the scope they work inside, so an assistant with no subjects of
 * their own receives the supervisor's whole scope. Assigning specific subjects to
 * an assistant narrows them to that subset.
 *
 * Resolving this at read time means granting a capability is enough to make it
 * usable: the assistant immediately sees the supervisor's subjects, adds a
 * session to one, and records attendance, instead of the administrator having to
 * also tick every subject by hand.
 */
export function effectiveSubjectIds(professor: SubjectScopeSource): string[] {
  const own = professor.subjects.map((link) => link.subjectId);

  if (professor.kind === "ASSISTANT" && own.length === 0) {
    return professor.supervisor?.subjects.map((link) => link.subjectId) ?? [];
  }

  return own;
}

async function loadProfile(): Promise<ProfessorProfile | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/sign-in");
  if (session.user.role !== "PROFESSOR") redirect("/unauthorized");

  const professor = await prisma.professor.findUnique({
    where: { userId: session.user.id },
    select: {
      id: true,
      userId: true,
      employeeCode: true,
      kind: true,
      supervisor: {
        select: {
          user: { select: { fullName: true } },
          subjects: { select: { subjectId: true } },
        },
      },
      user: { select: { fullName: true } },
      subjects: { select: { subjectId: true } },
      permissions: { select: { permission: true } },
    },
  });

  if (!professor) return null;

  const grants = professor.permissions
    .map((grant) => grant.permission)
    .filter(isProfessorPermissionKey);

  return {
    id: professor.id,
    userId: professor.userId,
    fullName: professor.user.fullName,
    employeeCode: professor.employeeCode,
    kind: professor.kind,
    supervisorName: professor.supervisor?.user.fullName ?? null,
    subjectIds: effectiveSubjectIds(professor),
    grants,
    can: (permission) => grants.includes(permission),
  };
}

export async function getProfessorProfile(): Promise<ProfessorProfile> {
  const profile = await loadProfile();
  if (!profile) redirect("/unauthorized");
  return profile;
}

/**
 * Throws a domain error when the professor was not granted the capability.
 * Call it inside a try block so server actions return the message to the form.
 */
export async function assertProfessorGrant(
  userId: string,
  permission: ProfessorPermissionKey,
): Promise<void> {
  const professor = await prisma.professor.findUnique({
    where: { userId },
    select: { permissions: { where: { permission }, select: { id: true } } },
  });

  if (!professor || professor.permissions.length === 0) {
    throw new Error(`لا تملك صلاحية «${professorPermissionLabel(permission)}». راجع مدير النظام.`);
  }
}

/** Throws unless the professor owns the given subject. Admins bypass via the caller. */
export async function assertProfessorSubject(
  userId: string,
  subjectId: string,
  message = "لا تملك صلاحية التنفيذ في هذه المادة.",
): Promise<void> {
  const professor = await prisma.professor.findUnique({
    where: { userId },
    select: {
      kind: true,
      subjects: { select: { subjectId: true } },
      supervisor: { select: { subjects: { select: { subjectId: true } } } },
    },
  });

  const allowed = professor ? new Set(effectiveSubjectIds(professor)) : new Set<string>();

  if (!allowed.has(subjectId)) throw new Error(message);
}

/**
 * Grant + subject-scope check for actions that receive an exam id.
 * Use it before any mutation that targets an exam, its questions, or its scores.
 */
export async function assertProfessorExamAccess(
  userId: string,
  examId: string,
  permission: ProfessorPermissionKey,
  message = "لا تملك صلاحية التنفيذ في هذا الامتحان.",
): Promise<void> {
  await assertProfessorGrant(userId, permission);

  const exam = await prisma.exam.findUnique({
    where: { id: examId },
    select: { subjectId: true },
  });

  if (!exam) throw new Error("الامتحان غير موجود.");

  await assertProfessorSubject(userId, exam.subjectId, message);
}

export type GradingActor = {
  professorId: string;
  userId: string;
  fullName: string;
  subjectIds: string[];
};

export async function requireGradingActor(): Promise<GradingActor> {
  const profile = await getProfessorProfile();
  return {
    professorId: profile.id,
    userId: profile.userId,
    fullName: profile.fullName,
    subjectIds: profile.subjectIds,
  };
}

export type ProfessorScope = { professorId: string; subjectIds: string[] };

/** Non-redirecting scope loader for server actions: null when the user is not a professor. */
export async function loadProfessorScope(userId: string): Promise<ProfessorScope | null> {
  const professor = await prisma.professor.findUnique({
    where: { userId },
    select: {
      id: true,
      kind: true,
      subjects: { select: { subjectId: true } },
      supervisor: { select: { subjects: { select: { subjectId: true } } } },
    },
  });

  if (!professor) return null;

  return {
    professorId: professor.id,
    subjectIds: effectiveSubjectIds(professor),
  };
}
