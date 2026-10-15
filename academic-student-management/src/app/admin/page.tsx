import { BookOpen, CalendarCheck, FileQuestion, GraduationCap } from "lucide-react";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { adminNavItems } from "@/components/admin-nav";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { attendanceTone, Progress } from "@/components/ui/progress";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState, QueryErrorState } from "@/components/ui/states";
import { authOptions } from "@/auth";
import { getAdminOverview } from "@/lib/dashboard-data";
import { formatDateTime, formatNumber, formatPercent } from "@/lib/format";
import { activityLabel, roleLabels } from "@/lib/labels";

const navItems = adminNavItems;

export default async function AdminDashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/sign-in");

  const overview = await getAdminOverview();

  return (
    <AppShell
      navItems={navItems}
      roleLabel={roleLabels.ADMIN}
      subtitle="نظرة شاملة على الطلاب والمواد والحضور والامتحانات"
      title="لوحة تحكم مدير النظام"
      userName={session.user.name ?? "مدير النظام"}
    >
      {!overview.ok ? (
        <QueryErrorState message={overview.message} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              hint="إجمالي الطلاب المسجلين"
              icon={GraduationCap}
              label="عدد الطلاب"
              tone="blue"
              value={formatNumber(overview.data.studentsCount)}
            />
            <StatCard
              hint="المواد الدراسية المعتمدة"
              icon={BookOpen}
              label="عدد المواد"
              tone="emerald"
              value={formatNumber(overview.data.subjectsCount)}
            />
            <StatCard
              hint="حاضر مقابل غياب بدون عذر"
              icon={CalendarCheck}
              label="نسبة الحضور العامة"
              tone={attendanceTone(overview.data.attendance.percentage)}
              value={formatPercent(overview.data.attendance.percentage)}
            />
            <StatCard
              hint={`من ${formatNumber(overview.data.gradedAttempts)} محاولة مصححة`}
              icon={FileQuestion}
              label="متوسط درجات الامتحانات"
              tone="amber"
              value={formatPercent(overview.data.examsAverage)}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>نِسب الحضور حسب المادة</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                {overview.data.subjectsOverview.length === 0 ? (
                  <EmptyState
                    description="أضف مواد دراسية وتسجل طلاباً لعرض النسب."
                    title="لا توجد مواد لعرضها"
                  />
                ) : (
                  overview.data.subjectsOverview.map((subject) => (
                    <div key={subject.id}>
                      <div className="mb-2 flex items-center justify-between text-sm">
                        <span className="font-medium text-slate-700 dark:text-slate-200">{subject.name}</span>
                        <span className="text-slate-500">
                          {formatPercent(subject.attendance)} · {formatNumber(subject.students)} طالب
                        </span>
                      </div>
                      <Progress tone={attendanceTone(subject.attendance)} value={subject.attendance} />
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>ملخص الحضور</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <Row label="حضور" tone="text-emerald-600" value={formatNumber(overview.data.attendance.present)} />
                <Row label="غياب" tone="text-rose-600" value={formatNumber(overview.data.attendance.absent)} />
                <Row label="غياب بعذر" tone="text-amber-600" value={formatNumber(overview.data.attendance.excused)} />
                <Row label="إجمالي السجلات" value={formatNumber(overview.data.attendance.total)} />
                <Row label="أعضاء هيئة التدريس" value={formatNumber(overview.data.professorsCount)} />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>النشاطات الأخيرة</CardTitle>
            </CardHeader>
            <CardContent>
              {overview.data.activity.length === 0 ? (
                <EmptyState description="ستظهر هنا العمليات المسجلة في سجل النشاط." title="لا يوجد نشاط بعد" />
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {overview.data.activity.map((entry) => (
                    <li className="flex items-center justify-between gap-4 py-3" key={entry.id}>
                      <div>
                        <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
                          {activityLabel(entry.action)}
                        </p>
                        <p className="text-xs text-slate-500">
                          {entry.userName ?? "مستخدم محذوف"} · {entry.entity}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs text-slate-400">{formatDateTime(entry.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </AppShell>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      <span className={`font-semibold ${tone ?? "text-slate-800 dark:text-slate-100"}`}>{value}</span>
    </div>
  );
}
