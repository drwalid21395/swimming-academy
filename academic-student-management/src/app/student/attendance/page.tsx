import { CalendarCheck, CalendarDays, TriangleAlert, UserX } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/primitives";
import { attendanceTone, Progress } from "@/components/ui/progress";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState, QueryErrorState } from "@/components/ui/states";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { databaseErrorMessage } from "@/lib/dashboard-data";
import { formatDate, formatNumber, formatPercent } from "@/lib/format";
import { getStudentProfile } from "@/lib/student-auth";
import { listStudentAttendance } from "@/lib/student-portal";

import { StudentShell } from "../shell";

const statusLabels: Record<string, { label: string; tone: "success" | "danger" | "warning" }> = {
  PRESENT: { label: "حاضر", tone: "success" },
  ABSENT: { label: "غائب", tone: "danger" },
  EXCUSED: { label: "بعذر", tone: "warning" },
};

export default async function StudentAttendancePage() {
  const profile = await getStudentProfile();

  const result = await listStudentAttendance(profile.id).catch((error) => {
    console.error("[student-attendance]", error);
    return null;
  });

  return (
    <StudentShell
      subtitle="سجل حضورك في موادك ونسب الغياب مقابل الحد المعتمد"
      title="حضوري"
      userName={profile.fullName}
    >
      {!result ? (
        <QueryErrorState message={databaseErrorMessage} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              hint="محاضرة في موادك"
              icon={CalendarDays}
              label="عدد المحاضرات"
              tone="blue"
              value={formatNumber(result.totalSessions)}
            />
            <StatCard
              hint="نسبة حضورك في كل المواد"
              icon={CalendarCheck}
              label="نسبة الحضور"
              tone={attendanceTone(result.overallPercentage)}
              value={formatPercent(result.overallPercentage)}
            />
            <StatCard
              hint="مرات الغياب المسجلة"
              icon={UserX}
              label="أيام الغياب"
              tone="rose"
              value={formatNumber(
                result.rows.reduce((sum, row) => sum + row.absentCount, 0),
              )}
            />
            <StatCard
              hint="مادة تحت الحد المسموح"
              icon={TriangleAlert}
              label="مواد تحتاج متابعة"
              tone="amber"
              value={formatNumber(result.lowSubjects)}
            />
          </div>

          <div>
            <PageHeader
              description={`${formatNumber(result.rows.length)} مادة · ${formatNumber(result.totalSessions)} محاضرة`}
              title="ملخص الحضور حسب المادة"
            />

            <div className="space-y-4">
              {result.rows.length === 0 ? (
                <Card>
                  <CardContent>
                    <EmptyState
                      description="لم تسجل في أي مادة بعد."
                      title="لا توجد مواد"
                    />
                  </CardContent>
                </Card>
              ) : (
                result.rows.map((row) => (
                  <Card key={row.subjectId}>
                    <CardHeader>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <CardTitle>
                            {row.subjectName} (<span dir="ltr">{row.subjectCode}</span>)
                          </CardTitle>
                          <p className="mt-1 text-xs text-muted">
                            حد الحضور: {formatPercent(row.attendanceLimit, 0)} ·{" "}
                            {formatNumber(row.sessionsCount)} محاضرة
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {row.isLow && <Badge tone="danger">دون الحد المطلوب</Badge>}
                          <Badge tone="success">{formatNumber(row.presentCount)} حاضر</Badge>
                          <Badge tone="danger">{formatNumber(row.absentCount)} غائب</Badge>
                          {row.excusedCount > 0 && (
                            <Badge tone="warning">{formatNumber(row.excusedCount)} بعذر</Badge>
                          )}
                        </div>
                      </div>
                    </CardHeader>

                    <CardContent>
                      <div className="mb-4">
                        <div className="mb-1.5 flex items-center justify-between text-xs">
                          <span className="text-muted">نسبة الحضور الكلية</span>
                          <span className="font-semibold text-slate-700 dark:text-slate-200">
                            {formatPercent(row.percentage)}
                          </span>
                        </div>
                        <Progress
                          tone={attendanceTone(row.percentage, row.attendanceLimit)}
                          value={row.percentage}
                        />
                      </div>

                      {row.sessions.length === 0 ? (
                        <p className="text-sm text-muted">لا توجد محاضرات مسجلة في هذه المادة.</p>
                      ) : (
                        <div className="overflow-x-auto">
                          <Table>
                            <THead>
                              <TR>
                                <TH>المحاضرة</TH>
                                <TH>التاريخ</TH>
                                <TH>الأستاذ</TH>
                                <TH>الحالة</TH>
                              </TR>
                            </THead>
                            <TBody>
                              {row.sessions.map((session) => {
                                const status = session.status
                                  ? statusLabels[session.status]
                                  : null;

                                return (
                                  <TR key={session.id}>
                                    <TD>{session.title ?? "محاضرة بدون عنوان"}</TD>
                                    <TD>{formatDate(session.date)}</TD>
                                    <TD>{session.professorName}</TD>
                                    <TD>
                                      {status ? (
                                        <Badge tone={status.tone}>{status.label}</Badge>
                                      ) : (
                                        <span className="text-xs text-muted">لم يُسجّل بعد</span>
                                      )}
                                    </TD>
                                  </TR>
                                );
                              })}
                            </TBody>
                          </Table>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </StudentShell>
  );
}
