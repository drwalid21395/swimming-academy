import { BookOpen, Building2, UserRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PublicShell } from "@/components/public-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { formatNumber } from "@/lib/format";
import { getPublicDepartment, listPublicProfessors } from "@/lib/public-portal";

export const metadata: Metadata = {
  title: "قسم | البوابة العامة",
  robots: { index: false, follow: false },
};

export const revalidate = 120;

export default async function PublicDepartmentPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const department = await getPublicDepartment(code);

  if (!department) notFound();

  const professors = await listPublicProfessors(department.id);

  return (
    <PublicShell
      crumbs={[{ label: department.name }]}
      icon={Building2}
      subtitle={`${formatNumber(professors.length)} دكتور — ${department.code}`}
      title={department.name}
    >
      {department.description && (
        <Card>
          <CardContent className="pt-6 text-sm leading-8 text-muted">{department.description}</CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserRound aria-hidden className="size-5" />
            دكاترة القسم
          </CardTitle>
          <CardDescription>اضغط على الدكتور لعرض مواده.</CardDescription>
        </CardHeader>
        <CardContent>
          {professors.length === 0 ? (
            <EmptyState description="لا يوجد دكتور مسجل في هذا القسم بعد." title="لا يوجد دكتورون" />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {professors.map((professor) => (
                <div
                  className="rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-4"
                  key={professor.id}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-extrabold text-[var(--app-text)]">{professor.fullName}</p>
                      <p className="mt-0.5 text-xs text-muted">{professor.employeeCode}</p>
                    </div>
                    <Badge tone="blue">{formatNumber(professor.subjectsCount)} مادة</Badge>
                  </div>

                  <ul className="mt-3 space-y-1.5">
                    {professor.subjects.length === 0 ? (
                      <li className="text-xs text-muted">لا توجد مواد مسندة.</li>
                    ) : (
                      professor.subjects.map((subject) => (
                        <li key={subject.id}>
                          <Link
                            className="flex items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-sm transition hover:bg-[var(--glass-bg-strong)]"
                            href={`/public/subject/${subject.id}`}
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <BookOpen aria-hidden className="size-4 shrink-0 text-muted" />
                              <span className="truncate font-semibold text-[var(--app-text)]">
                                {subject.name}
                              </span>
                            </span>
                            <span className="flex shrink-0 items-center gap-1.5">
                              {subject.isPrimary && <Badge tone="success">رئيسي</Badge>}
                              <span className="text-xs text-muted">{subject.code}</span>
                            </span>
                          </Link>
                        </li>
                      ))
                    )}
                  </ul>

                  <Link
                    className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:underline dark:text-brand-300"
                    href={`/public/professor/${professor.id}`}
                  >
                    صفحة الدكتور
                    <span aria-hidden>←</span>
                  </Link>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </PublicShell>
  );
}
