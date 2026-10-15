import { ArrowRight, CalendarCheck, Percent, UserX } from "lucide-react";
import { getServerSession } from "next-auth";
import { notFound, redirect } from "next/navigation";

import { adminNavItems } from "@/components/admin-nav";
import { AppShell } from "@/components/app-shell";
import { ExcelDownloadLink } from "@/components/excel-download-link";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/primitives";
import { attendanceTone, Progress } from "@/components/ui/progress";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState, QueryErrorState } from "@/components/ui/states";
import { authOptions } from "@/auth";
import { getAttendanceSheet, getAttendanceTrend } from "@/lib/attendance";
import { databaseErrorMessage } from "@/lib/dashboard-data";
import { formatDate, formatDateTime, formatNumber, formatPercent } from "@/lib/format";
import { roleLabels } from "@/lib/labels";
import { hasPermission } from "@/lib/permissions";

import { AttendanceSheet } from "../attendance-sheet";
import { SessionRowActions } from "../session-row-actions";

export default async function AdminAttendanceSessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/sign-in");

  const canRecord = hasPermission(session.user.role, "attendance.record");
  const canDelete = hasPermission(session.user.role, "attendance.delete");

  const { id } = await params;

  const [sheet, trend] = await Promise.all([
    getAttendanceSheet(id).catch((error) => {
      console.error("[attendance-session]", error);
      return undefined;
    }),
    getAttendanceTrend(id).catch(() => []),
  ]);

  if (sheet === undefined) {
    return (
      <AppShell
        navItems={adminNavItems}
        roleLabel={roleLabels.ADMIN}
        subtitle="تعذر تحميل بيانات المحاضرة"
        title="تسجيل الحضور"
        userName={session.user.name ?? "مدير النظام"}
      >
        <QueryErrorState message={databaseErrorMessage} />
      </AppShell>
    );
  }

  if (!sheet) notFound();

  return (
    <AppShell
      navItems={adminNavItems}
      roleLabel={roleLabels.ADMIN}
      subtitle={`${sheet.subjectName} · ${sheet.professorName} · ${formatDate(sheet.date)}`}
      title={sheet.title ?? "محاضرة بدون عنوان"}
      userName={session.user.name ?? "مدير النظام"}
    >
      <div>
        <PageHeader
          actions={
            <>
              <ExcelDownloadLink
                href={`/api/excel/attendance-session?sessionId=${sheet.id}`}
                label="تحميل سجل المحاضرة"
                title="ملف إكسل بكامل طلاب المحاضرة وتوقيت التسجيل"
              />
              <ExcelDownloadLink
                href={`/api/excel/attendance-matrix?subjectId=${sheet.subjectId}`}
                label="كل محاضرات المادة"
                title="ورقة واحدة فيها كل طلاب المادة وكل محاضراتها"
                variant="ghost"
              />
              <ButtonLink href="/admin/attendance" size="sm" variant="secondary">
                <ArrowRight aria-hidden className="size-4" />
                رجوع للقائمة
              </ButtonLink>
              <SessionRowActions
                canDelete={canDelete}
                label={sheet.title ?? sheet.subjectName}
                sessionId={sheet.id}
              />
            </>
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
            hint="سجل مسجل في هذه المحاضرة"
            icon={Percent}
            label="نسبة الحضور"
            tone={attendanceTone(sheet.summary.percentage)}
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
                readOnly={!canRecord}
                rows={sheet.rows}
                sessionId={sheet.id}
              />
            )}
          </CardContent>
        </Card>

        <TrendCard trend={trend} />
      </div>
    </AppShell>
  );
}

function TrendCard({
  trend,
}: {
  trend: { id: string; date: Date; title: string | null; summary: { percentage: number | null } }[];
}) {
  if (trend.length === 0) return null;

  return (
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
                  tone={attendanceTone(item.summary.percentage)}
                  value={item.summary.percentage}
                />
              </span>
              <Badge tone={attendanceTone(item.summary.percentage) === "rose" ? "danger" : "success"}>
                {formatPercent(item.summary.percentage)}
              </Badge>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
