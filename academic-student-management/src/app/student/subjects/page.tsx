import { BookOpen, CalendarCheck, FileQuestion, TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/primitives";
import { attendanceTone, Progress } from "@/components/ui/progress";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState, QueryErrorState } from "@/components/ui/states";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { databaseErrorMessage } from "@/lib/dashboard-data";
import { formatNumber, formatPercent } from "@/lib/format";
import { getStudentProfile } from "@/lib/student-auth";
import { listStudentSubjects } from "@/lib/student-portal";

import { StudentShell } from "../shell";

export default async function StudentSubjectsPage() {
  const profile = await getStudentProfile();

  const result = await listStudentSubjects(profile.id).catch((error) => {
    console.error("[student-subjects]", error);
    return null;
  });

  return (
    <StudentShell
      subtitle="موادك المسجلة، ساعاتها المعتمدة، ونسب حضورك فيها"
      title="موادي"
      userName={profile.fullName}
    >
      {!result ? (
        <QueryErrorState message={databaseErrorMessage} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              hint="مادة مسجلة في الفصل"
              icon={BookOpen}
              label="عدد المواد"
              tone="blue"
              value={formatNumber(result.totalSubjects)}
            />
            <StatCard
              hint="مجموع الساعات المعتمدة"
              icon={FileQuestion}
              label="الساعات المعتمدة"
              tone="violet"
              value={formatNumber(result.totalCredits)}
            />
            <StatCard
              hint="نسبة حضورك في كل المواد"
              icon={CalendarCheck}
              label="متوسط الحضور"
              tone={attendanceTone(result.overallAttendance)}
              value={formatPercent(result.overallAttendance)}
            />
            <StatCard
              hint="مادة تحت حد الحضور المطلوب"
              icon={TriangleAlert}
              label="مواد تحتاج متابعة"
              tone="rose"
              value={formatNumber(result.lowAttendanceSubjects)}
            />
          </div>

          <div>
            <PageHeader
              description={`${formatNumber(result.totalSubjects)} مادة مسجلة`}
              title="قائمة المواد"
            />

            <Card className="overflow-hidden">
              {result.rows.length === 0 ? (
                <CardContent>
                  <EmptyState
                    description="لم تسجل في أي مادة بعد. راجع شؤون التسجيل في الكلية."
                    title="لا توجد مواد مسجلة"
                  />
                </CardContent>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>المادة</TH>
                      <TH>القسم</TH>
                      <TH>الأستاذ</TH>
                      <TH>الساعات</TH>
                      <TH>الامتحانات</TH>
                      <TH>متوسط الدرجات</TH>
                      <TH className="w-48">نسبة الحضور</TH>
                      <TH>إجراءات</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {result.rows.map((row) => (
                      <TR key={row.id}>
                        <TD>
                          <p className="font-semibold text-slate-800 dark:text-slate-100">
                            {row.name}
                          </p>
                          <p className="text-xs text-slate-500" dir="ltr">
                            {row.code}
                          </p>
                        </TD>
                        <TD>{row.departmentName}</TD>
                        <TD>{row.professorName ?? <span className="text-muted">—</span>}</TD>
                        <TD>{formatNumber(row.creditHours)}</TD>
                        <TD>
                          {formatNumber(row.examsCount)}
                          {row.pendingCount > 0 && (
                            <Badge className="ms-2" tone="warning">
                              {formatNumber(row.pendingCount)} بانتظار التصحيح
                            </Badge>
                          )}
                        </TD>
                        <TD>
                          {row.averagePercentage === null ? (
                            <span className="text-muted">—</span>
                          ) : (
                            formatPercent(row.averagePercentage)
                          )}
                        </TD>
                        <TD>
                          <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
                            <span className="text-slate-500">
                              {formatNumber(row.recordsCount)} سجل
                            </span>
                            <span className="font-semibold text-slate-700 dark:text-slate-200">
                              {formatPercent(row.attendancePercentage)}
                            </span>
                          </div>
                          <Progress
                            size="sm"
                            tone={attendanceTone(row.attendancePercentage, row.attendanceLimit)}
                            value={row.attendancePercentage}
                          />
                        </TD>
                        <TD>
                          <div className="flex justify-end gap-2">
                            <ButtonLink
                              href={`/student/subjects/${row.id}/practice`}
                              size="sm"
                              variant="ghost"
                            >
                              ممارسة
                            </ButtonLink>
                            <ButtonLink href="/student/exams" size="sm" variant="ghost">
                              امتحانات المادة
                            </ButtonLink>
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
