import {
  BookOpen,
  Building2,
  CalendarClock,
  FileQuestion,
  Globe,
  Library,
  Newspaper,
  UserRound,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PublicShell } from "@/components/public-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/states";
import { formatNumber } from "@/lib/format";
import { listPublicDepartments, listPublicSubjects } from "@/lib/public-portal";
import { getSiteBranding } from "@/lib/site-branding";

import { SubjectSearch } from "./subject-search";

export async function generateMetadata(): Promise<Metadata> {
  const branding = await getSiteBranding();
  return {
    title: `البوابة العامة | ${branding.siteName}`,
    description: "تصفح الأقسام والدكاترة والمواد والامتحانات المتاحة بدون تسجيل دخول.",
    robots: { index: false, follow: false },
  };
}

export const revalidate = 120;

export default async function PublicHomePage() {
  const [departments, subjects] = await Promise.all([
    listPublicDepartments(),
    listPublicSubjects(),
  ]);

  if (departments.length === 0 && subjects.length === 0) {
    return (
      <PublicShell
        icon={Globe}
        subtitle="تصفح الأقسام والدكاترة والمواد بدون تسجيل دخول."
        title="البوابة العامة"
      >
        <Card>
          <CardContent className="pt-6">
            <EmptyState
              description="لم يتم نشر أي أقسام أو مواد بعد. عد لاحقاً."
              title="لا توجد بيانات عامة"
            />
          </CardContent>
        </Card>
      </PublicShell>
    );
  }

  const professorsCount = departments.reduce((sum, item) => sum + item.professorsCount, 0);

  return (
    <PublicShell
      icon={Globe}
      subtitle="تصفح الأقسام والدكاترة والمواد والامتحانات المتاحة بدون تسجيل دخول."
      title="البوابة العامة"
      aside={
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BookOpen aria-hidden className="size-5" />
                مادة مباشرة
              </CardTitle>
              <CardDescription>ابحث باسم المادة أو الكود لفتحها فوراً.</CardDescription>
            </CardHeader>
            <CardContent>
              <SubjectSearch subjects={subjects} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>طريقة التصفح</CardTitle>
              <CardDescription>ثلاث خطوات فقط.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {[
                { icon: Building2, text: "اختر القسم الدراسي." },
                { icon: UserRound, text: "تابع إلى الدكتور المسؤول." },
                { icon: BookOpen, text: "افتح المادة واختر الامتحانات أو بنك الأسئلة أو الإعلانات." },
              ].map((step, index) => (
                <div className="flex items-start gap-3" key={step.text}>
                  <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-brand-500/12 text-xs font-extrabold text-brand-700 dark:text-brand-200">
                    {index + 1}
                  </span>
                  <p className="flex items-center gap-2 pt-1.5 text-[var(--app-text)]">
                    <step.icon aria-hidden className="size-4 text-muted" />
                    {step.text}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          hint="أقسام مفعلة"
          icon={Building2}
          label="الأقسام"
          tone="blue"
          value={formatNumber(departments.length)}
        />
        <StatCard
          hint="دكاترة مسجلون"
          icon={UserRound}
          label="الدكاترة"
          tone="emerald"
          value={formatNumber(professorsCount)}
        />
        <StatCard
          hint="مواد موزعة على الأقسام"
          icon={BookOpen}
          label="المواد"
          tone="violet"
          value={formatNumber(subjects.length)}
        />
        <StatCard
          hint="مفتوحة للتصفح العام"
          icon={FileQuestion}
          label="امتحانات منشورة"
          tone="amber"
          value="حسب المادة"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>الأقسام الدراسية</CardTitle>
          <CardDescription>اختر القسم لعرض دكاترته ومواده.</CardDescription>
        </CardHeader>
        <CardContent>
          {departments.length === 0 ? (
            <EmptyState description="لا توجد أقسام مسجلة." title="لا توجد أقسام" />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {departments.map((department) => (
                <Link
                  className="rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-4 transition hover:border-brand-500/40 hover:shadow-[0_18px_40px_-30px_rgba(61,102,248,0.9)]"
                  href={`/public/department/${department.code}`}
                  key={department.id}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-extrabold text-[var(--app-text)]">{department.name}</p>
                      <p className="mt-0.5 text-xs text-muted">{department.code}</p>
                    </div>
                    <Badge tone="brand">{formatNumber(department.subjectsCount)} مادة</Badge>
                  </div>

                  {department.description && (
                    <p className="mt-2.5 line-clamp-2 text-xs leading-6 text-muted">
                      {department.description}
                    </p>
                  )}

                  <p className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-brand-600 dark:text-brand-300">
                    <UserRound aria-hidden className="size-3.5" />
                    {formatNumber(department.professorsCount)} دكتور
                    <span aria-hidden className="mx-1 text-slate-400">
                      •
                    </span>
                    <Library aria-hidden className="size-3.5" />
                    {formatNumber(department.subjectsCount)} مادة
                  </p>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Newspaper aria-hidden className="size-5" />
            أحدث المواد
          </CardTitle>
          <CardDescription>روابط سريعة لأحدث المواد المضافة.</CardDescription>
        </CardHeader>
        <CardContent>
          {subjects.length === 0 ? (
            <EmptyState description="لا توجد مواد منشورة." title="لا توجد مواد" />
          ) : (
            <ul className="divide-y divide-[var(--glass-border)]">
              {subjects.slice(0, 6).map((subject) => (
                <li className="flex flex-wrap items-center justify-between gap-2 py-3" key={subject.id}>
                  <div className="min-w-0">
                    <p className="font-semibold text-[var(--app-text)]">{subject.name}</p>
                    <p className="text-xs text-muted">
                      {subject.code} — {subject.department.name} — {subject.academicTerm.name}
                    </p>
                  </div>
                  <Link
                    className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--glass-border)] px-3 py-1.5 text-xs font-semibold transition hover:bg-[var(--glass-bg-strong)]"
                    href={`/public/subject/${subject.id}`}
                  >
                    <CalendarClock aria-hidden className="size-3.5" />
                    فتح
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </PublicShell>
  );
}
