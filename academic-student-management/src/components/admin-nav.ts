import {
  BarChart3,
  BookOpen,
  CalendarCheck,
  FileQuestion,
  KeyRound,
  Layers,
  LayoutDashboard,
  Library,
  Newspaper,
  ScrollText,
  Settings,
  Users,
} from "lucide-react";

import type { NavItem } from "@/components/app-shell";

export const adminNavItems: NavItem[] = [
  { href: "/admin", label: "لوحة التحكم", icon: LayoutDashboard },
  { href: "/admin/students", label: "الطلاب", icon: Users },
  { href: "/admin/specializations", label: "التخصصات", icon: Layers },
  { href: "/admin/subjects", label: "المواد الدراسية", icon: BookOpen },
  { href: "/admin/attendance", label: "الحضور والغياب", icon: CalendarCheck },
  { href: "/admin/exams", label: "الامتحانات", icon: FileQuestion },
  { href: "/admin/questions", label: "بنك الأسئلة", icon: Library },
  { href: "/admin/announcements", label: "الأخبار والإعلانات", icon: Newspaper },
  { href: "/admin/professor-permissions", label: "صلاحيات الدكاترة", icon: KeyRound },
  { href: "/admin/reports", label: "التقارير", icon: BarChart3 },
  { href: "/admin/audit-log", label: "سجل التدقيق", icon: ScrollText },
  { href: "/admin/settings", label: "إعدادات النظام", icon: Settings },
];
