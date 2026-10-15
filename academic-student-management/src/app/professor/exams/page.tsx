import { CheckCircle2, ClipboardCheck, FileQuestion, Gauge, ListChecks } from "lucide-react";
import { redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState, QueryErrorState } from "@/components/ui/states";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDateTime, formatNumber, formatPercent, formatScore } from "@/lib/format";
import { examStatusLabels } from "@/lib/labels";
import { listProfessorExams } from "@/lib/professor-exams";
import { getProfessorProfile } from "@/lib/professor-auth";

import { ProfessorShell } from "../shell";

const statusTones = {
  DRAFT: "neutral",
  PUBLISHED: "success",
  CLOSED: "warning",
  ARCHIVED: "blue",
} as const;

export default async function ProfessorExamsPage({
  searchParams,
}: {
  searchParams: Promise<{ subject?: string; status?: string; q?: string; new?: string }>;
}) {
  const profile = await getProfessorProfile();
  if (!profile.can("EXAMS_MANAGE")) redirect("/unauthorized");
  const { subject, status, q, new: openNew } = await searchParams;

  let result: Awaited<ReturnType<typeof listProfessorExams>> | null = null;
  let errorMessage: string | null = null;

  try {
    result = await listProfessorExams(profile.subjectIds, {
      subjectId: subject && profile.subjectIds.includes(subject) ? subject : undefined,
      status: status === "DRAFT" || status === "PUBLISHED" || status === "CLOSED" ? status : undefined,
      query: q,
    });
  } catch (error) {
    console.error("[professor/exams]", error);
    errorMessage = "تعذر تحميل الامتحانات. حاول مرة أخرى.";
  }

  const data = result;

  return (
    <ProfessorShell
      grants={profile.grants}
      kind={profile.kind}
      subtitle={`${profile.fullName} · ${formatNumber(profile.subjectIds.length)} مادة مسندة`}
      title="امتحانات موادك"
      userName={profile.fullName}
    >
      {errorMessage || !data ? (
        <QueryErrorState message={errorMessage ?? "تعذر تحميل الامتحانات."} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              hint="ضمن موادك المسندة"
              icon={FileQuestion}
              label="عدد الامتحانات"
              tone="blue"
              value={formatNumber(data.total)}
            />
            <StatCard
              hint="منشورة للطلاب"
              icon={CheckCircle2}
              label="امتحانات منشورة"
              tone="emerald"
              value={formatNumber(data.publishedCount)}
            />
            <StatCard
              hint="بانتظار تصحيحك"
              icon={ClipboardCheck}
              label="محاولات تحتاج تصحيح"
              tone="amber"
              value={formatNumber(data.pendingCount)}
            />
            <StatCard
              hint="متوسط درجات الطلاب"
              icon={Gauge}
              label="المتوسط العام"
              tone="violet"
              value={formatPercent(data.averagePercentage)}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center justify-between gap-3">
                <span>قائمة الامتحانات</span>
                <span className="text-xs font-medium text-muted">
                  {formatNumber(data.attemptsCount)} محاولة · {formatNumber(data.gradedCount)} مصححة
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {data.rows.length === 0 ? (
                <EmptyState
                  description="سيتم إنشاء الامتحانات من قبل المدير أو من صفحة إدارة الامتحانات."
                  title="لا توجد امتحانات في موادك"
                />
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>الامتحان</TH>
                      <TH>المادة</TH>
                      <TH>الحالة</TH>
                      <TH>موعد الامتحان</TH>
                      <TH>المحاولات</TH>
                      <TH>يحتاج تصحيح</TH>
                      <TH>المتوسط</TH>
                      <TH />
                    </TR>
                  </THead>
                  <TBody>
                    {data.rows.map((row) => {
                      return (
                        <TR key={row.id}>
                          <TD>
                            <p className="font-semibold text-[var(--app-text)]">{row.title}</p>
                            <p className="text-xs text-muted">
                              {formatNumber(row.questionsCount)} سؤال · {formatScore(row.totalScore, 0)} درجة
                            </p>
                          </TD>
                          <TD>
                            <p className="text-sm">{row.subjectName}</p>
                            <p className="text-xs text-muted">{row.subjectCode}</p>
                          </TD>
                          <TD>
                            <Badge tone={statusTones[row.status as keyof typeof statusTones] ?? "neutral"}>
                              {examStatusLabels[row.status as keyof typeof examStatusLabels] ?? row.status}
                            </Badge>
                          </TD>
                          <TD className="whitespace-nowrap text-sm text-muted">
                            {formatDateTime(row.startsAt)}
                          </TD>
                          <TD className="text-sm">{formatNumber(row.attemptsCount)}</TD>
                          <TD>
                            {row.pendingCount > 0 ? (
                              <Badge tone="warning">
                                <ListChecks aria-hidden className="size-3.5" />
                                {formatNumber(row.pendingCount)}
                              </Badge>
                            ) : (
                              <span className="text-sm text-muted">—</span>
                            )}
                          </TD>
                          <TD className="min-w-32">
                            <Progress tone="blue" value={row.averagePercentage ?? 0} />
                            <p className="mt-1 text-xs text-muted">
                              {formatPercent(row.averagePercentage)}
                            </p>
                          </TD>
                          <TD>
                            <ButtonLink href={`/professor/exams/${row.id}`} size="sm" variant="secondary">
                              التفاصيل
                            </ButtonLink>
                          </TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <div className="flex flex-wrap justify-center gap-2">
            <ButtonLink href="/professor/questions" variant="secondary">
              بنك الأسئلة
            </ButtonLink>
            <ButtonLink href="/professor/grading" variant="secondary">
              قائمة تصحيح الإجابات
            </ButtonLink>
            <ButtonLink href="/professor" variant="ghost">
              العودة للوحة التحكم
            </ButtonLink>
          </div>
        </>
      )}
    </ProfessorShell>
  );
}
