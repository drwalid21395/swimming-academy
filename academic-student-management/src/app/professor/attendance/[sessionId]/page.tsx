import { ArrowRight, CalendarCheck, Percent, UserX } from "lucide-react";
import { notFound, redirect } from "next/navigation";

import { AttendanceSheet } from "@/app/admin/attendance/attendance-sheet";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/primitives";
import { attendanceTone, Progress } from "@/components/ui/progress";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState, QueryErrorState } from "@/components/ui/states";
import { getAttendanceSheet, getAttendanceTrend } from "@/lib/attendance";
import { databaseErrorMessage } from "@/lib/dashboard-data";
import { formatDate, formatDateTime, formatNumber, formatPercent } from "@/lib/format";
import { getProfessorProfile } from "@/lib/professor-auth";

import { ProfessorShell } from "../../shell";

export default async function ProfessorAttendanceSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const profile = await getProfessorProfile();
  if (!profile.can("ATTENDANCE_RECORD")) redirect("/unauthorized");

  const { sessionId } = await params;
  const scope = { subjectIds: profile.subjectIds };

  const [sheet, trend] = await Promise.all([
    getAttendanceSheet(sessionId, scope).catch((error) => {
      console.error("[professor-attendance-session]", error);
      return undefined;
    }),
    getAttendanceTrend(sessionId, 10, scope).catch(() => []),
  ]);

  if (sheet === undefined) {
    return (
      <ProfessorShell
        grants={profile.grants}
        kind={profile.kind}
        subtitle="تعذر تحميل بيانات المحاضرة"
        title="تسجيل الحضور"
        userName={profile.fullName}
      >
        <QueryErrorState message={databaseErrorMessage} />
      </ProfessorShell>
    );
  }

  if (!sheet) notFound();

  return (
    <ProfessorShell
      grants={profile.grants}
      kind={profile.kind}
      subtitle={`${sheet.subjectName} · ${formatDate(sheet.date)}`}
      title={sheet.title ?? "محاضرة بدون عنوان"}
      userName={profile.fullName}
    >
      <div>
        <PageHeader
          actions={
            <ButtonLink href="/professor/attendance" size="sm" variant="secondary">
              <ArrowRight aria-hidden className="size-4" />
              رجوع للقائمة
            </ButtonLink>
          }
          description={`${sheet.subjectCode} · أُنشئت في ${formatDateTime(sheet.createdAt)} · حد الحضور ${formatNumber(sheet.attendanceLimit)}٪`}
          title="سجل حضور المحاضرة"
        />

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            hint="طالب مسجل في المادة"
            icon={CalendarCheck}
            label="عدد الطلاب"
            tone="blue"
            value={formatNumber(sheet.rows.length)}
          />
          <StatCard
            hint="نسبة الحضور في هذه المحاضرة"
            icon={Percent}
            label="نسبة الحضور"
            tone={attendanceTone(sheet.summary.percentage, sheet.attendanceLimit)}
            value={formatPercent(sheet.summary.percentage)}
          />
          <StatCard
            hint="غياب مسجل في المحاضرة"
            icon={UserX}
            label="الغيابات"
            tone="rose"
            value={formatNumber(sheet.summary.absent)}
          />
          <StatCard
            hint="محاضرة مسجلة للمادة"
            icon={CalendarCheck}
            label="إجمالي المحاضرات"
            tone="violet"
            value={formatNumber(sheet.sessionsCount)}
          />
        </div>

        {sheet.notes && (
          <Card>
            <CardHeader>
              <CardTitle>ملاحظات المحاضرة</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-7 text-muted">{sheet.notes}</p>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>تسجيل الحضور</CardTitle>
          </CardHeader>
          <CardContent>
            {sheet.rows.length === 0 ? (
              <EmptyState
                description="لا يوجد طلاب مسجلون في هذه المادة."
                title="لا يوجد طلاب للتسجيل"
              />
            ) : (
              <AttendanceSheet
                attendanceLimit={sheet.attendanceLimit}
                key={sheet.id}
                readOnly={false}
                rows={sheet.rows}
                sessionId={sheet.id}
              />
            )}
          </CardContent>
        </Card>

        {trend.length > 0 && (
          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle>آخر نسب الحضور في المادة</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {trend.map((item) => (
                  <li className="flex flex-wrap items-center gap-3" key={item.id}>
                    <span className="w-32 shrink-0 text-xs font-semibold text-muted">
                      {formatDate(item.date)}
                    </span>
                    <span className="min-w-40 flex-1 text-xs font-bold text-[var(--app-text)]">
                      {item.title ?? "محاضرة بدون عنوان"}
                    </span>
                    <span className="w-full sm:w-56">
                      <Progress
                        size="sm"
                        tone={attendanceTone(item.summary.percentage, sheet.attendanceLimit)}
                        value={item.summary.percentage}
                      />
                    </span>
                    <Badge
                      tone={
                        attendanceTone(item.summary.percentage, sheet.attendanceLimit) === "rose"
                          ? "danger"
                          : "success"
                      }
                    >
                      {formatPercent(item.summary.percentage)}
                    </Badge>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </ProfessorShell>
  );
}
