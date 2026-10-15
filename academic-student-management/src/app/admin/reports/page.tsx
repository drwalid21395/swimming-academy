import { BarChart3, GraduationCap, CalendarCheck, FileQuestion, TriangleAlert } from "lucide-react";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { adminNavItems } from "@/components/admin-nav";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress, attendanceTone } from "@/components/ui/progress";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState, QueryErrorState } from "@/components/ui/states";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { authOptions } from "@/auth";
import type { AppRole } from "@/lib/authorization";
import { formatNumber, formatPercent, formatScore } from "@/lib/format";
import { roleLabels } from "@/lib/labels";
import { hasPermission } from "@/lib/permissions";
import {
  buildReportSummary,
  getGradeDistribution,
  getSubjectComparison,
  listReportFilters,
  subjectComparisonCsv,
} from "@/lib/reports";

import { CsvExportButton } from "./csv-export-button";
import { ReportFilters } from "./report-filters";

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/sign-in");
  if (!hasPermission(session.user.role as AppRole, "reports.view")) redirect("/unauthorized");

  const params = await searchParams;
  const value = (key: string) => {
    const raw = params[key];
    return typeof raw === "string" ? raw : "";
  };

  const filters = { termId: value("termId"), subjectId: value("subjectId") };
  const options = await listReportFilters();

  if (!options.ok) {
    return (
      <AppShell
        navItems={adminNavItems}
        roleLabel={roleLabels.ADMIN}
        subtitle="تحليلات أكاديمية ومقارنة بين المواد."
        title="التقارير"
        userName={session.user.name ?? "مدير النظام"}
      >
        <QueryErrorState message={options.message} />
      </AppShell>
    );
  }

  const [comparison, distribution] = await Promise.all([
    getSubjectComparison(filters),
    getGradeDistribution(filters),
  ]);
  const summary = buildReportSummary(comparison);

  const maxBucket = Math.max(1, ...distribution.map((bucket) => bucket.count));

  return (
    <AppShell
      navItems={adminNavItems}
      roleLabel={roleLabels.ADMIN}
      subtitle="تحليلات أكاديمية ومقارنة بين المواد."
      title="التقارير"
      userName={session.user.name ?? "مدير النظام"}
    >
      <Card>
        <CardHeader>
          <CardTitle>نطاق التقرير</CardTitle>
          <CardDescription>اختر الفصل الدراسي والمادة لتحديث الأرقام والجداول.</CardDescription>
        </CardHeader>
        <CardContent>
          <ReportFilters
            initial={filters}
            subjects={options.data.subjects}
            terms={options.data.terms}
          />
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          hint="إجمالي التسجيلات النشطة"
          icon={GraduationCap}
          label="الطلاب"
          tone="blue"
          value={formatNumber(summary.studentsCount)}
        />
        <StatCard
          hint="المواد ضمن النطاق المختار"
          icon={BarChart3}
          label="المواد"
          tone="emerald"
          value={formatNumber(summary.subjectsCount)}
        />
        <StatCard
          hint="متوسط مرجّح للحضور"
          icon={CalendarCheck}
          label="نسبة الحضور"
          tone={attendanceTone(summary.attendancePercentage)}
          value={formatPercent(summary.attendancePercentage)}
        />
        <StatCard
          hint={`${formatNumber(summary.gradedAttempts)} محاولة مصححة`}
          icon={FileQuestion}
          label="متوسط الدرجات"
          tone="amber"
          value={formatScore(summary.averageScore)}
        />
      </div>

      <Card>
        <CardHeader className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>مقارنة المواد</CardTitle>
            <CardDescription>الحضور والدرجات والطلاب أقل من حد الحضور لكل مادة.</CardDescription>
          </div>
          <CsvExportButton csv={subjectComparisonCsv(comparison)} fileName="subjects-report.csv" />
        </CardHeader>

        <CardContent>
          {comparison.length === 0 ? (
            <EmptyState
              description="لا توجد مواد مطابقة للنطاق المختار."
              title="لا توجد بيانات"
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>المادة</TH>
                  <TH>الطلاب</TH>
                  <TH>نسبة الحضور</TH>
                  <TH>الامتحانات</TH>
                  <TH>متوسط الدرجة</TH>
                  <TH>أقل من حد الحضور</TH>
                </TR>
              </THead>
              <TBody>
                {comparison.map((row) => (
                  <TR key={row.subjectId}>
                    <TD>
                      <div className="flex flex-col">
                        <span className="font-semibold text-[var(--app-text)]">{row.subjectName}</span>
                        <span className="text-xs text-slate-500">{row.subjectCode}</span>
                      </div>
                    </TD>
                    <TD>{formatNumber(row.studentsCount)}</TD>
                    <TD className="min-w-40">
                      <div className="flex items-center gap-2">
                        <Progress tone={attendanceTone(row.attendancePercentage)} value={row.attendancePercentage} />
                        <span className="shrink-0 text-xs font-semibold">
                          {formatPercent(row.attendancePercentage)}
                        </span>
                      </div>
                    </TD>
                    <TD>{formatNumber(row.examsCount)}</TD>
                    <TD>{formatScore(row.averageScore)}</TD>
                    <TD>
                      {row.lowAttendanceCount === 0 ? (
                        <Badge tone="success">لا يوجد</Badge>
                      ) : (
                        <Badge tone="danger">{formatNumber(row.lowAttendanceCount)} طالب</Badge>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>توزيع الدرجات</CardTitle>
            <CardDescription>نسبة المحاولات المصححة في كل شريحة.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {distribution.every((bucket) => bucket.count === 0) ? (
              <EmptyState description="لا توجد محاولات مصححة في النطاق المختار." title="لا توجد درجات" />
            ) : (
              distribution.map((bucket) => (
                <div key={bucket.label}>
                  <div className="mb-1.5 flex items-center justify-between text-sm">
                    <span className="font-medium text-slate-700 dark:text-slate-200">{bucket.label}</span>
                    <span className="text-slate-500">{formatNumber(bucket.count)}</span>
                  </div>
                  <Progress tone="blue" value={(bucket.count / maxBucket) * 100} />
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>مؤشرات تستدعي الانتباه</CardTitle>
            <CardDescription>بنود تحتاج تدخلاً إدارياً سريعاً.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <AlertRow
              tone={summary.lowAttendanceCount > 0 ? "warning" : "success"}
              title={`${formatNumber(summary.lowAttendanceCount)} طالب أقل من حد الحضور`}
              description="راجع صفحة الحضور لتنبيه الطلاب أو تعديل النسب."
            />
            <AlertRow
              tone={summary.attendancePercentage < 75 ? "warning" : "success"}
              title={`متوسط الحضور ${formatPercent(summary.attendancePercentage)}`}
              description="المتوسط المرجّح لكل المواد داخل النطاق المختار."
            />
            <AlertRow
              tone={summary.gradedAttempts === 0 ? "warning" : "success"}
              title={`${formatNumber(summary.gradedAttempts)} محاولة مصححة`}
              description={
                summary.gradedAttempts === 0
                  ? "لم يتم تصحيح أي امتحان في هذا النطاق بعد."
                  : "تم بناء متوسط الدرجات من المحاولات المصححة."
              }
            />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function AlertRow({
  title,
  description,
  tone,
}: {
  title: string;
  description: string;
  tone: "success" | "warning";
}) {
  return (
    <div
      className={`flex items-start gap-3 rounded-2xl px-4 py-3 text-sm ring-1 ring-inset ${
        tone === "warning"
          ? "bg-amber-500/10 text-amber-800 ring-amber-500/25 dark:text-amber-200"
          : "bg-emerald-500/10 text-emerald-800 ring-emerald-500/25 dark:text-emerald-200"
      }`}
    >
      <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div>
        <p className="font-semibold">{title}</p>
        <p className="opacity-80">{description}</p>
      </div>
    </div>
  );
}
