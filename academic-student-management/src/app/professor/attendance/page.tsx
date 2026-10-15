import { CalendarCheck, CalendarDays, TriangleAlert, Users } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/primitives";
import { attendanceTone, Progress } from "@/components/ui/progress";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState, QueryErrorState } from "@/components/ui/states";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import {
  getSessionSubjects,
  listAttendanceSessions,
  parseAttendanceFilters,
  type AttendanceFilters as Filters,
  type AttendanceSearchParams,
} from "@/lib/attendance";
import { databaseErrorMessage } from "@/lib/dashboard-data";
import { formatDate, formatNumber, formatPercent } from "@/lib/format";
import { getProfessorProfile } from "@/lib/professor-auth";
import { AttendanceFilters } from "@/app/admin/attendance/attendance-filters";
import { SessionFormDialog } from "@/app/admin/attendance/session-form-dialog";

import { ProfessorShell } from "../shell";

function pageHref(filters: Filters, page: number) {
  const params = new URLSearchParams();

  if (filters.query) params.set("query", filters.query);
  if (filters.subjectId) params.set("subjectId", filters.subjectId);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (page > 1) params.set("page", String(page));

  const search = params.toString();
  return search ? `/professor/attendance?${search}` : "/professor/attendance";
}

export default async function ProfessorAttendancePage({
  searchParams,
}: {
  searchParams: Promise<AttendanceSearchParams>;
}) {
  const profile = await getProfessorProfile();
  if (!profile.can("ATTENDANCE_RECORD")) redirect("/unauthorized");

  const scope = { subjectIds: profile.subjectIds };
  const filters = parseAttendanceFilters(await searchParams);

  const [result, subjects] = await Promise.all([
    listAttendanceSessions(filters, scope).catch((error) => {
      console.error("[professor-attendance]", error);
      return null;
    }),
    getSessionSubjects(scope).catch(() => []),
  ]);

  return (
    <ProfessorShell
      grants={profile.grants}
      kind={profile.kind}
      subtitle="إنشاء المحاضرات وتسجيل حضور طلاب موادك"
      title="تسجيل الحضور"
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
              hint="سجل حضور مسجل"
              icon={CalendarCheck}
              label="سجلات الحضور"
              tone="violet"
              value={formatNumber(result.totalRecords)}
            />
            <StatCard
              hint="نسبة الحضور العامة لمواديك"
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
              <AttendanceFilters
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
                subjects.length > 0 ? (
                  <SessionFormDialog
                    creators={[
                      {
                        id: profile.id,
                        fullName: profile.fullName,
                        employeeCode: profile.employeeCode,
                        isActive: true,
                      },
                    ]}
                    fixedCreatorId={profile.id}
                    subjects={subjects}
                  />
                ) : undefined
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
                      <TH>التسجيل</TH>
                      <TH className="w-48">نسبة الحضور</TH>
                      <TH>إجراءات</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {result.rows.map((row) => {
                      const isComplete =
                        row.markedCount >= row.studentsCount && row.studentsCount > 0;

                      return (
                        <TR key={row.id}>
                          <TD>
                            <Link
                              className="font-semibold text-slate-800 hover:text-brand-700 dark:text-slate-100"
                              href={`/professor/attendance/${row.id}`}
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
                            <div className="flex justify-end">
                              <ButtonLink
                                href={`/professor/attendance/${row.id}`}
                                prefetch={false}
                                size="sm"
                                variant="ghost"
                              >
                                تسجيل الحضور
                              </ButtonLink>
                            </div>
                          </TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
              )}
            </Card>

            {result.pageCount > 1 && (
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
                    className={
                      result.page >= result.pageCount ? "pointer-events-none opacity-50" : undefined
                    }
                    href={pageHref(filters, Math.min(result.pageCount, result.page + 1))}
                    size="sm"
                    variant="secondary"
                  >
                    التالي
                  </ButtonLink>
                </div>
              </div>
            )}
          </div>

          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle>طلاب دون حد الحضور</CardTitle>
            </CardHeader>
            {result.lowAttendance.length === 0 ? (
              <CardContent>
                <p className="text-sm text-muted">
                  لا يوجد طلاب تحت حد الحضور المطلوب في موادك الحالية.
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
                      <TD>{row.fullName}</TD>
                      <TD dir="ltr">{row.universityId}</TD>
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
    </ProfessorShell>
  );
}
