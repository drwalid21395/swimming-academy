import {
  BookOpen,
  CalendarCheck,
  ClipboardCheck,
  FileQuestion,
  LayoutDashboard,
  Library,
  Newspaper,
} from "lucide-react";

import type { ProfessorKind } from "@prisma/client";

import { AppShell, type NavItem } from "@/components/app-shell";
import { roleLabels } from "@/lib/labels";
import type { ProfessorPermissionKey } from "@/lib/professor-permissions";

/** Which granted capability unlocks each professor section. */
export const professorSectionPermissions = {
  "/professor/attendance": "ATTENDANCE_RECORD",
  "/professor/subjects": "SUBJECTS_MANAGE",
  "/professor/exams": "EXAMS_MANAGE",
  "/professor/grading": "RESULTS_VIEW",
  "/professor/questions": "QUESTIONS_MANAGE",
  "/professor/announcements": "ANNOUNCEMENTS_PUBLISH",
} as const satisfies Record<string, ProfessorPermissionKey>;

export const assistantRoleLabel = "عضو هيئة معاونة";

const baseNavItems: NavItem[] = [
  { href: "/professor", label: "لوحة التحكم", icon: LayoutDashboard },
  { href: "/professor/subjects", label: "موادي", icon: BookOpen },
  { href: "/professor/attendance", label: "تسجيل الحضور", icon: CalendarCheck },
  { href: "/professor/exams", label: "الامتحانات", icon: FileQuestion },
  { href: "/professor/grading", label: "تصحيح الإجابات", icon: ClipboardCheck },
  { href: "/professor/questions", label: "بنك الأسئلة", icon: Library },
  { href: "/professor/announcements", label: "المنشورات", icon: Newspaper },
];

export const professorNavItems: NavItem[] = baseNavItems;

/** Hides every section whose capability the administrator has not granted. */
export function professorNavItemsFor(grants: ProfessorPermissionKey[]): NavItem[] {
  const granted = new Set<ProfessorPermissionKey>(grants);

  return baseNavItems.filter((item) => {
    const required = (professorSectionPermissions as Record<string, ProfessorPermissionKey | undefined>)[
      item.href
    ];
    if (!required) return true;
    return granted.has(required);
  });
}

export function ProfessorShell({
  title,
  subtitle,
  userName,
  grants,
  kind = "PROFESSOR",
  children,
}: {
  title: string;
  subtitle: string;
  userName: string;
  grants?: ProfessorPermissionKey[];
  kind?: ProfessorKind;
  children: React.ReactNode;
}) {
  return (
    <AppShell
      navItems={grants ? professorNavItemsFor(grants) : professorNavItems}
      roleLabel={kind === "ASSISTANT" ? assistantRoleLabel : roleLabels.PROFESSOR}
      subtitle={subtitle}
      title={title}
      userName={userName}
    >
      {children}
    </AppShell>
  );
}
