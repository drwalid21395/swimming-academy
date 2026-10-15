import { Award, CheckCheck, Hourglass, TrendingUp } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/primitives";
import { Progress } from "@/components/ui/progress";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState, QueryErrorState } from "@/components/ui/states";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { databaseErrorMessage } from "@/lib/dashboard-data";
import { formatDateTime, formatNumber, formatPercent, formatScore } from "@/lib/format";
import { getStudentProfile } from "@/lib/student-auth";
import { listStudentGrades } from "@/lib/student-portal";

import { StudentShell } from "../shell";

function gradeTone(percentage: number | null) {
  if (percentage === null) return "blue" as const;
  if (percentage >= 80) return "emerald" as const;
  if (percentage >= 60) return "amber" as const;
  return "rose" as const;
}

export default async function StudentGradesPage() {
  const profile = await getStudentProfile();

  const result = await listStudentGrades(profile.id).catch((error) => {
    console.error("[student-grades]", error);
    return null;
  });

  return (
    <StudentShell
      subtitle="نتائج امتحاناتك بعد التصحيح ونسبتك في كل مادة"
      title="درجاتي"
      userName={profile.fullName}
    >
      {!result ? (
        <QueryErrorState message={databaseErrorMessage} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              hint="امتحان تم تصحيحه"
              icon={CheckCheck}
              label="درجات مُصححة"
              tone="emerald"
              value={formatNumber(result.gradedCount)}
            />
            <StatCard
              hint="بانتظار تصحيح الأستاذ"
              icon={Hourglass}
              label="بانتظار التصحيح"
              tone="amber"
              value={formatNumber(result.pendingCount)}
            />
            <StatCard
              hint="متوسط نسبك في الامتحانات المصححة"
              icon={TrendingUp}
              label="متوسط الدرجات"
              tone={gradeTone(result.averagePercentage)}
              value={formatPercent(result.averagePercentage)}
            />
            <StatCard
              hint="أعلى نسبة حصلت عليها"
              icon={Award}
              label="أعلى نسبة"
              tone="violet"
              value={formatPercent(result.bestPercentage)}
            />
          </div>

          <div>
            <PageHeader
              description={`${formatNumber(result.rows.length)} محاولة · ${formatNumber(result.subjectsCount)} مادة`}
              title="سجل الدرجات"
            />

            <Card className="overflow-hidden">
              {result.rows.length === 0 ? (
                <CardContent>
                  <EmptyState
                    description="لم تدخل أي امتحان بعد. ستظهر نتائجك هنا بعد تصحيحها."
                    title="لا توجد درجات"
                  />
                </CardContent>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>الامتحان</TH>
                      <TH>المادة</TH>
                      <TH>الحالة</TH>
                      <TH>الدرجة</TH>
                      <TH className="w-48">النسبة</TH>
                      <TH>وقت التسليم</TH>
                      <TH>إجراءات</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {result.rows.map((row) => (
                      <TR key={row.attemptId}>
                        <TD>
                          <p className="font-semibold text-slate-800 dark:text-slate-100">
                            {row.examTitle}
                          </p>
                          {row.feedback && (
                            <p className="mt-1 max-w-sm text-xs text-muted">{row.feedback}</p>
                          )}
                        </TD>
                        <TD>
                          {row.subjectName}
                          <p className="text-xs text-slate-500" dir="ltr">
                            {row.subjectCode}
                          </p>
                        </TD>
                        <TD>
                          {row.status === "GRADED" ? (
                            <Badge tone="success">مصحح</Badge>
                          ) : row.status === "SUBMITTED" ? (
                            <Badge tone="warning">بانتظار التصحيح</Badge>
                          ) : row.status === "IN_PROGRESS" ? (
                            <Badge tone="neutral">جارية</Badge>
                          ) : (
                            <Badge tone="neutral">{row.status}</Badge>
                          )}
                          {row.pendingReview && row.status === "SUBMITTED" && (
                            <p className="mt-1 text-xs text-muted">تحتوي أسئلة كتابية</p>
                          )}
                        </TD>
                        <TD>
                          {row.status === "GRADED" ? (
                            <span className="font-bold">
                              {formatScore(row.score)} / {formatScore(row.totalScore, 0)}
                            </span>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </TD>
                        <TD>
                          {row.percentage === null ? (
                            <span className="text-muted">—</span>
                          ) : (
                            <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
                              <span className="font-semibold text-slate-700 dark:text-slate-200">
                                {formatPercent(row.percentage)}
                              </span>
                            </div>
                          )}
                          {row.percentage !== null && (
                            <Progress size="sm" tone={gradeTone(row.percentage)} value={row.percentage} />
                          )}
                        </TD>
                        <TD className="text-xs">
                          {row.submittedAt ? formatDateTime(row.submittedAt) : "—"}
                        </TD>
                        <TD>
                          <div className="flex justify-end">
                            {row.status === "GRADED" ? (
                              <Link
                                className="text-xs font-bold text-brand-700 hover:text-brand-800 dark:text-brand-200"
                                href={`/student/exams/${row.examId}/result`}
                              >
                                عرض النتيجة
                              </Link>
                            ) : (
                              <ButtonLink href="/student/exams" size="sm" variant="ghost">
                                الامتحانات
                              </ButtonLink>
                            )}
                          </div>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </Card>
          </div>
        </>
      )}
    </StudentShell>
  );
}
