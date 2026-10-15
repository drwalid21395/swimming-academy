import {
  BookOpen,
  CalendarCheck,
  FileQuestion,
  LayoutDashboard,
  Newspaper,
  TrendingUp,
} from "lucide-react";

import { AppShell, type NavItem } from "@/components/app-shell";
import { roleLabels } from "@/lib/labels";

export const studentNavItems: NavItem[] = [
  { href: "/student", label: "لوحة التحكم", icon: LayoutDashboard },
  { href: "/student/subjects", label: "موادي", icon: BookOpen },
  { href: "/student/attendance", label: "حضوري", icon: CalendarCheck },
  { href: "/student/exams", label: "امتحاناتي", icon: FileQuestion },
  { href: "/student/grades", label: "درجاتي", icon: TrendingUp },
  { href: "/student/news", label: "الأخبار", icon: Newspaper },
];

export function StudentShell({
  title,
  subtitle,
  userName,
  children,
}: {
  title: string;
  subtitle: string;
  userName: string;
  children: React.ReactNode;
}) {
  return (
    <AppShell
      navItems={studentNavItems}
      roleLabel={roleLabels.STUDENT}
      subtitle={subtitle}
      title={title}
      userName={userName}
    >
      {children}
    </AppShell>
  );
}
