import { CalendarCheck, CalendarDays, TriangleAlert, Users } from "lucide-react";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

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
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { authOptions } from "@/auth";
import {
  getSessionCreators,
  getSessionSubjects,
  listAttendanceSessions,
  parseAttendanceFilters,
  type AttendanceFilters,
  type AttendanceSearchParams,
} from "@/lib/attendance";
import { databaseErrorMessage } from "@/lib/dashboard-data";
import { formatDate, formatNumber, formatPercent } from "@/lib/format";
import { roleLabels } from "@/lib/labels";
import { hasPermission } from "@/lib/permissions";

import { AttendanceFilters as Filters } from "./attendance-filters";
import { SessionFormDialog } from "./session-form-dialog";
import { SessionRowActions } from "./session-row-actions";

function pageHref(filters: AttendanceFilters, page: number) {
  const params = new URLSearchParams();

  if (filters.query) params.set("query", filters.query);
  if (filters.subjectId) params.set("subjectId", filters.subjectId);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (page > 1) params.set("page", String(page));

  const search = params.toString();
  return search ? `/admin/attendance?${search}` : "/admin/attendance";
}

export default async function AdminAttendancePage({
  searchParams,
}: {
  searchParams: Promise<AttendanceSearchParams>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/sign-in");

  const canRecord = hasPermission(session.user.role, "attendance.record");
  const canDelete = hasPermission(session.user.role, "attendance.delete");

  const filters = parseAttendanceFilters(await searchParams);

  const [result, subjects, creators] = await Promise.all([
    listAttendanceSessions(filters).catch((error) => {
      console.error("[attendance]", error);
      return null;
    }),
    getSessionSubjects().catch(() => []),
    getSessionCreators().catch(() => []),
  ]);

  return (
    <AppShell
      navItems={adminNavItems}
      roleLabel={roleLabels.ADMIN}
      subtitle="إنشاء المحاضرات وتسجيل حضور الطلاب ومتابعة نسب الغياب"
      title="الحضور والغياب"
      userName={session.user.name ?? "مدير النظام"}
    >
      {!result ? (
        <QueryErrorState message={databaseErrorMessage} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              hint="محاضرة مسجلة في النظام"
              icon={CalendarDays}
              label="عدد المحاضرات"
              tone="blue"
              value={formatNumber(result.totalSessions)}
            />
            <StatCard
              hint="سجل حضور مسجل"
              icon={CalendarCheck}
              label="سجلات الحضور"
              tone="violet"
              value={formatNumber(result.totalRecords)}
            />
            <StatCard
              hint="نسبة الحضور العامة"
              icon={Users}
              label="متوسط الحضور"
              tone={attendanceTone(result.overall.percentage)}
              value={formatPercent(result.overall.percentage)}
            />
            <StatCard
              hint="دون الحد المسموح في موادهم"
              icon={TriangleAlert}
              label="طلاب يحتاجون متابعة"
              tone="rose"
              value={formatNumber(result.lowAttendance.length)}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>تصفية وبحث</CardTitle>
            </CardHeader>
            <CardContent>
              <Filters
                initial={{
                  query: filters.query ?? "",
                  subjectId: filters.subjectId ?? "",
                  from: filters.from ?? "",
                  to: filters.to ?? "",
                }}
                subjects={subjects}
              />
            </CardContent>
          </Card>

          <div>
            <PageHeader
              actions={
                <>
                  {filters.subjectId && subjects.length > 0 && (
                    <ExcelDownloadLink
                      href={`/api/excel/attendance-matrix?subjectId=${filters.subjectId}`}
                      label="تحميل كل المحاضرات"
                      title="ورقة واحدة فيها كل طلاب المادة وكل محاضراتها"
                    />
                  )}
                  {canRecord && (
                    <SessionFormDialog
                      creators={creators.map((creator) => ({
                        id: creator.id,
                        fullName: creator.user.fullName,
                        employeeCode: creator.employeeCode,
                        isActive: creator.user.isActive,
                      }))}
                      subjects={subjects}
                    />
                  )}
                </>
              }
              description={`${formatNumber(result.total)} محاضرة مطابقة للفلاتر الحالية`}
              title="المحاضرات"
            />

            <Card className="overflow-hidden">
              {result.rows.length === 0 ? (
                <CardContent>
                  <EmptyState
                    description="أنشئ محاضرة جديدة ثم سجّل حضور طلاب المادة."
                    title="لا توجد محاضرات مسجلة"
                  />
                </CardContent>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>المحاضرة</TH>
                      <TH>المادة</TH>
                      <TH>التاريخ</TH>
                      <TH>الأستاذ</TH>
                      <TH>التسجيل</TH>
                      <TH className="w-48">نسبة الحضور</TH>
                      <TH>إجراءات</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {result.rows.map((row) => {
                      const isComplete = row.markedCount >= row.studentsCount && row.studentsCount > 0;

                      return (
                        <TR key={row.id}>
                          <TD>
                            {/* No prefetch: every session page runs an aggregation over
                                the whole history of its subject, and a page of rows holds
                                two links each. Prefetching them all on scroll fired dozens
                                of those queries at once and froze the list. */}
                            <Link
                              className="font-semibold text-slate-800 hover:text-brand-700 dark:text-slate-100"
                              href={`/admin/attendance/${row.id}`}
                              prefetch={false}
                            >
                              {row.title ?? "محاضرة بدون عنوان"}
                            </Link>
                            <p className="text-xs text-slate-500" dir="ltr">
                              {row.subjectCode}
                            </p>
                          </TD>
                          <TD>{row.subjectName}</TD>
                          <TD>{formatDate(row.date)}</TD>
                          <TD>{row.professorName}</TD>
                          <TD>
                            {isComplete ? (
                              <Badge tone="success">مكتمل</Badge>
                            ) : (
                              <Badge tone="warning">
                                {formatNumber(row.markedCount)} / {formatNumber(row.studentsCount)}
                              </Badge>
                            )}
                          </TD>
                          <TD>
                            <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
                              <span className="text-slate-500">
                                {formatNumber(row.attendance.present)} /{" "}
                                {formatNumber(row.attendance.total)}
                              </span>
                              <span className="font-semibold text-slate-700 dark:text-slate-200">
                                {formatPercent(row.attendance.percentage)}
                              </span>
                            </div>
                            <Progress
                              size="sm"
                              tone={attendanceTone(row.attendance.percentage)}
                              value={row.attendance.percentage}
                            />
                          </TD>
                          <TD>
                            <div className="flex flex-wrap items-center justify-end gap-2">
                              <ButtonLink
                                href={`/admin/attendance/${row.id}`}
                                prefetch={false}
                                size="sm"
                                variant="ghost"
                              >
                                {canRecord ? "تسجيل الحضور" : "عرض"}
                              </ButtonLink>
                              <ExcelDownloadLink
                                href={`/api/excel/attendance-session?sessionId=${row.id}`}
                                label="إكسل"
                                title={`تحميل سجل حضور هذه المحاضرة (${row.subjectName})`}
                              />
                              <ExcelDownloadLink
                                href={`/api/excel/attendance-matrix?subjectId=${row.subjectId}`}
                                label="كل المحاضرات"
                                title={`تحميل حضور كل محاضرات مادة ${row.subjectName} في ورقة واحدة`}
                                variant="ghost"
                              />
                              <SessionRowActions
                                canDelete={canDelete}
                                label={row.title ?? row.subjectName}
                                sessionId={row.id}
                              />
                            </div>
                          </TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
              )}
            </Card>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-500">
              <p>
                صفحة {formatNumber(result.page)} من {formatNumber(result.pageCount)} ·{" "}
                {formatNumber(result.total)} نتيجة
              </p>
              <div className="flex items-center gap-2">
                <ButtonLink
                  aria-disabled={result.page <= 1}
                  className={result.page <= 1 ? "pointer-events-none opacity-50" : undefined}
                  href={pageHref(filters, Math.max(1, result.page - 1))}
                  size="sm"
                  variant="secondary"
                >
                  السابق
                </ButtonLink>
                <ButtonLink
                  aria-disabled={result.page >= result.pageCount}
                  className={result.page >= result.pageCount ? "pointer-events-none opacity-50" : undefined}
                  href={pageHref(filters, Math.min(result.pageCount, result.page + 1))}
                  size="sm"
                  variant="secondary"
                >
                  التالي
                </ButtonLink>
              </div>
            </div>
          </div>

          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle>طلاب دون حد الحضور</CardTitle>
            </CardHeader>
            {result.lowAttendance.length === 0 ? (
              <CardContent>
                <p className="text-sm text-muted">
                  لا يوجد طلاب تحت حد الحضور المطلوب في المواد الحالية.
                </p>
              </CardContent>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>الطالب</TH>
                    <TH>الرقم الجامعي</TH>
                    <TH>المادة</TH>
                    <TH>حد الحضور</TH>
                    <TH className="w-48">النسبة</TH>
                    <TH>الغيابات</TH>
                  </TR>
                </THead>
                <TBody>
                  {result.lowAttendance.map((row) => (
                    <TR key={`${row.subjectId}-${row.studentId}`}>
                      <TD>
                        <Link
                          className="font-semibold text-slate-800 hover:text-brand-700 dark:text-slate-100"
                          href={`/admin/students/${row.studentId}`}
                        >
                          {row.fullName}
                        </Link>
                      </TD>
                      <TD>
                        <span className="text-slate-600 dark:text-slate-300" dir="ltr">
                          {row.universityId}
                        </span>
                      </TD>
                      <TD>{row.subjectName}</TD>
                      <TD>{formatPercent(row.attendanceLimit, 0)}</TD>
                      <TD>
                        <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
                          <span className="font-semibold text-rose-600 dark:text-rose-300">
                            {formatPercent(row.percentage)}
                          </span>
                        </div>
                        <Progress size="sm" tone="rose" value={row.percentage} />
                      </TD>
                      <TD>{formatNumber(row.absentCount)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>
        </>
      )}
    </AppShell>
  );
}
