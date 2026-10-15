import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { authOptions } from "@/auth";
import type { AppRole } from "@/lib/authorization";

export type Permission =
  | "students.view"
  | "students.manage"
  | "students.delete"
  | "specializations.manage"
  | "specializations.delete"
  | "subjects.view"
  | "subjects.manage"
  | "subjects.delete"
  | "attendance.view"
  | "attendance.record"
  | "attendance.delete"
  | "exams.view"
  | "exams.manage"
  | "exams.publish"
  | "exams.grade"
  | "exams.delete"
  | "questions.view"
  | "questions.manage"
  | "questions.delete"
  | "announcements.view"
  | "announcements.manage"
  | "announcements.delete"
  | "settings.manage"
  | "reports.view"
  | "audit.view"
  | "professors.permissions";

const rolePermissions: Record<AppRole, Permission[]> = {
  ADMIN: [
    "students.view",
    "students.manage",
    "students.delete",
    "specializations.manage",
    "specializations.delete",
    "subjects.view",
    "subjects.manage",
    "subjects.delete",
    "attendance.view",
    "attendance.record",
    "attendance.delete",
    "exams.view",
    "exams.manage",
    "exams.publish",
    "exams.grade",
    "exams.delete",
    "questions.view",
    "questions.manage",
    "questions.delete",
    "announcements.view",
    "announcements.manage",
    "announcements.delete",
    "settings.manage",
    "reports.view",
    "audit.view",
    "professors.permissions",
  ],
  // Professors have no student-management surface. The write capabilities below are
  // only a role gate: every action additionally verifies the granular grant in
  // ProfessorPermission plus subject scope, so the role flag alone grants nothing.
  PROFESSOR: [
    "subjects.view",
    "attendance.view",
    "attendance.record",
    "exams.view",
    "exams.manage",
    "exams.publish",
    "exams.grade",
    "questions.view",
    "questions.manage",
    "announcements.view",
    "announcements.manage",
  ],
  STUDENT: [
    "subjects.view",
    "attendance.view",
    "exams.view",
    "questions.view",
    "announcements.view",
  ],
};

export function hasPermission(role: AppRole, permission: Permission) {
  return rolePermissions[role].includes(permission);
}

export async function requirePermission(permission: Permission) {
  const session = await getServerSession(authOptions);

  if (!session?.user) redirect("/sign-in");

  const role = session.user.role as AppRole;
  if (!hasPermission(role, permission)) redirect("/unauthorized");

  return { id: session.user.id, name: session.user.name ?? "", role };
}


