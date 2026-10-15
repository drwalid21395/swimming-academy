import { BookOpen, Building2, GraduationCap, UserRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PublicShell } from "@/components/public-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/states";
import { formatNumber } from "@/lib/format";
import { getPublicProfessor } from "@/lib/public-portal";

export const metadata: Metadata = {
  title: "دكتور | البوابة العامة",
  robots: { index: false, follow: false },
};

export const revalidate = 120;

export default async function PublicProfessorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const professor = await getPublicProfessor(id);

  if (!professor) notFound();

  const currentSubjects = professor.subjects.filter((subject) => subject.academicTerm.isCurrent);
  const shown = currentSubjects.length > 0 ? currentSubjects : professor.subjects;

  return (
    <PublicShell
      crumbs={[
        { label: professor.department.name, href: `/public/department/${professor.department.code}` },
        { label: professor.fullName },
      ]}
      icon={UserRound}
      subtitle={`${professor.employeeCode} — ${professor.department.name}`}
      title={professor.fullName}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          hint="مادة في الفصل الحالي"
          icon={BookOpen}
          label="المواد"
          tone="blue"
          value={formatNumber(shown.length)}
        />
        <StatCard
          hint="مادة رئيسية"
          icon={GraduationCap}
          label="المواد الرئيسية"
          tone="emerald"
          value={formatNumber(professor.subjects.filter((subject) => subject.isPrimary).length)}
        />
        <StatCard
          hint="رمز القسم"
          icon={Building2}
          label="القسم"
          tone="violet"
          value={professor.department.code}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen aria-hidden className="size-5" />
            مواد الدكتور
          </CardTitle>
          <CardDescription>
            {currentSubjects.length > 0
              ? "مواد الفصل الدراسي الحالي."
              : "لا يوجد فصل حالي، لذا نعرض آخر المواد المسندة."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {shown.length === 0 ? (
            <EmptyState description="لا توجد مواد مسندة لهذا الدكتور." title="لا توجد مواد" />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {shown.map((subject) => (
                <Link
                  className="rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-4 transition hover:border-brand-500/40"
                  href={`/public/subject/${subject.id}`}
                  key={subject.id}
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-extrabold text-[var(--app-text)]">{subject.name}</p>
                    {subject.isPrimary && <Badge tone="success">رئيسي</Badge>}
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {subject.code} — {subject.academicTerm.name}
                  </p>
                  {subject.description && (
                    <p className="mt-2 line-clamp-2 text-xs leading-6 text-muted">
                      {subject.description}
                    </p>
                  )}
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </PublicShell>
  );
}
