import { CheckCircle2, ClipboardCheck, Gauge, Hourglass } from "lucide-react";
import { redirect } from "next/navigation";

import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState, QueryErrorState } from "@/components/ui/states";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDateTime, formatNumber, formatPercent, formatScore } from "@/lib/format";
import { getGradingQueue } from "@/lib/professor-exams";
import { getProfessorProfile } from "@/lib/professor-auth";

import { ProfessorShell } from "../shell";

export default async function ProfessorGradingQueuePage() {
  const profile = await getProfessorProfile();
  if (!profile.can("RESULTS_VIEW")) redirect("/unauthorized");

  let queue: Awaited<ReturnType<typeof getGradingQueue>> | null = null;
  let errorMessage: string | null = null;

  try {
    queue = await getGradingQueue(profile.subjectIds);
  } catch (error) {
    console.error("[professor/grading]", error);
    errorMessage = "تعذر تحميل قائمة التصحيح. حاول مرة أخرى.";
  }

  const data = queue;
  const waitingStudents = new Set(data?.rows.map((row) => row.universityId ?? row.studentName) ?? []).size;

  return (
    <ProfessorShell
      grants={profile.grants}
      kind={profile.kind}
      subtitle="المراجعة اليدوية للأسئلة الكتابية واعتماد الدرجات النهائية"
      title="تصحيح الإجابات"
      userName={profile.fullName}
    >
      {errorMessage || !data ? (
        <QueryErrorState message={errorMessage ?? "تعذر تحميل قائمة التصحيح."} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              hint="محاولات بانتظار مراجعتك"
              icon={ClipboardCheck}
              label="محاولات تحتاج تصحيح"
              tone="amber"
              value={formatNumber(data.pendingAttempts)}
            />
            <StatCard
              hint="أسئلة كتابية لم تُصحح بعد"
              icon={Hourglass}
              label="أسئلة تحتاج مراجعة"
              tone="violet"
              value={formatNumber(data.pendingQuestions)}
            />
            <StatCard
              hint="إجمالي المحاولات المسجلة"
              icon={Gauge}
              label="محاولات بانتظارك"
              tone="blue"
              value={formatNumber(data.rows.length)}
            />
            <StatCard
              hint="بانتظار تصحيحك"
              icon={CheckCircle2}
              label="طلاب مختلفون"
              tone="emerald"
              value={formatNumber(waitingStudents)}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center justify-between gap-3">
                <span>المحاولات بانتظار التصحيح</span>
                <span className="text-xs font-medium text-muted">الأقدم أولاً</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.rows.length === 0 ? (
                <EmptyState
                  description="لا توجد أسئلة كتابية تحتاج مراجعة حالياً. ستظهر هنا فور تسليم الطلاب إجاباتهم."
                  title="لا توجد محاولات بانتظار التصحيح"
                />
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>الطالب</TH>
                      <TH>الامتحان</TH>
                      <TH>المادة</TH>
                      <TH>وقت التسليم</TH>
                      <TH>أسئلة كتابية</TH>
                      <TH>الدرجة الحالية</TH>
                      <TH />
                    </TR>
                  </THead>
                  <TBody>
                    {data.rows.map((row) => (
                      <TR key={row.attemptId}>
                        <TD>
                          <p className="font-semibold text-[var(--app-text)]">{row.studentName}</p>
                          <p className="text-xs text-muted">{row.universityId ?? "—"}</p>
                        </TD>
                        <TD className="text-sm">{row.examTitle}</TD>
                        <TD>
                          <p className="text-sm">{row.subjectName}</p>
                          <p className="text-xs text-muted">{row.subjectCode}</p>
                        </TD>
                        <TD className="whitespace-nowrap text-sm text-muted">
                          {row.submittedAt ? formatDateTime(row.submittedAt) : "—"}
                        </TD>
                        <TD className="text-sm">
                          {formatNumber(row.pendingCount)}
                          <span className="text-xs text-muted">
                            {" "}
                            من {formatNumber(row.totalQuestions)}
                          </span>
                        </TD>
                        <TD className="whitespace-nowrap text-sm">
                          {formatScore(row.autoScore ?? 0)} / {formatScore(row.totalScore, 0)}
                        </TD>
                        <TD>
                          <ButtonLink
                            href={`/professor/grading/${row.attemptId}`}
                            size="sm"
                            variant="secondary"
                          >
                            تصحيح
                          </ButtonLink>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <div className="flex flex-wrap justify-center gap-2">
            <ButtonLink href="/professor/exams" variant="secondary">
              امتحانات موادك
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
