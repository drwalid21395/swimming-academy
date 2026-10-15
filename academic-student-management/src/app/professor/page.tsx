import {
  AlertTriangle,
  BookOpen,
  CalendarCheck,
  ClipboardCheck,
  FileQuestion,
  Newspaper,
  Users,
} from "lucide-react";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { attendanceTone, Progress } from "@/components/ui/progress";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState, QueryErrorState } from "@/components/ui/states";
import { authOptions } from "@/auth";
import { getProfessorOverview } from "@/lib/dashboard-data";
import { formatDate, formatDateTime, formatNumber, formatPercent } from "@/lib/format";
import { getGradingQueue } from "@/lib/professor-exams";
import { getProfessorProfile } from "@/lib/professor-auth";

import { ProfessorShell } from "./shell";

export default async function ProfessorDashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/sign-in");

  const profile = await getProfessorProfile();
  const overview = await getProfessorOverview(session.user.id);
  const queue = profile.can("RESULTS_VIEW")
    ? await getGradingQueue(profile.subjectIds).catch(() => null)
    : null;
  const data = overview.ok ? overview.data : null;

  const totalStudents = data?.subjects.reduce((sum, subject) => sum + subject.students, 0) ?? 0;
  const totalQuestions = data?.subjects.reduce((sum, subject) => sum + subject.questions, 0) ?? 0;
  const attendedSubjects = data?.subjects.filter((subject) => subject.attendance.percentage !== null) ?? [];
  const averageAttendance = attendedSubjects.length
    ? attendedSubjects.reduce((sum, subject) => sum + (subject.attendance.percentage ?? 0), 0) /
      attendedSubjects.length
    : null;

  return (
    <ProfessorShell
      grants={profile.grants}
      kind={profile.kind}
      subtitle="متابعة موادك وطلابك وحضورهم وامتحاناتهم"
      title="لوحة تحكم عضو هيئة التدريس"
      userName={session.user.name ?? "عضو هيئة التدريس"}
    >
      {!overview.ok ? (
        <QueryErrorState message={overview.message} />
      ) : (
        <>
          {profile.grants.length === 0 && (
            <Card className="ring-2 ring-amber-500/40">
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2 text-amber-800 dark:text-amber-200">
                  <AlertTriangle aria-hidden className="size-5" />
                  لا توجد صلاحيات ممنوحة لحسابك بعد
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted">
                <p>
                  لم يتم منحك أي صلاحية إدارية حتى الآن. تشمل الصلاحيات المتاحة: إدارة المواد،
                  وإضافة الأسئلة، وإنشاء الامتحانات، ومشاهدة النتائج، ونشر الإعلانات. راجع مدير
                  النظام لمنحك ما تحتاجه.
                </p>
              </CardContent>
            </Card>
          )}

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              icon={BookOpen}
              label="عدد موادي"
              tone="blue"
              value={formatNumber(data?.subjects.length ?? 0)}
            />
            <StatCard
              icon={Users}
              label="إجمالي الطلاب"
              tone="emerald"
              value={formatNumber(totalStudents)}
            />
            <StatCard
              icon={CalendarCheck}
              label="متوسط الحضور"
              tone={attendanceTone(averageAttendance)}
              value={formatPercent(averageAttendance)}
            />
            <StatCard
              icon={FileQuestion}
              label="أسئلة بنك الأسئلة"
              tone="amber"
              value={formatNumber(totalQuestions)}
            />
          </div>

          {queue && queue.pendingAttempts > 0 && (
            <Card className="ring-2 ring-amber-500/40">
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center justify-between gap-3 text-amber-800 dark:text-amber-200">
                  <span className="flex items-center gap-2">
                    <ClipboardCheck aria-hidden className="size-5" />
                    محاولات تنتظر تصحيحك
                  </span>
                  <ButtonLink href="/professor/grading" size="sm" variant="secondary">
                    فتح قائمة التصحيح
                  </ButtonLink>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted">
                  {formatNumber(queue.pendingAttempts)} محاولة ·{" "}
                  {formatNumber(queue.pendingQuestions)} سؤال كتابي يحتاج مراجعة قبل اعتماد الدرجات.
                </p>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {queue.rows.slice(0, 4).map((row) => (
                    <li
                      className="flex items-center justify-between gap-3 rounded-xl bg-[var(--glass-bg)] px-3 py-2 text-sm ring-1 ring-inset ring-[var(--glass-border)]"
                      key={row.attemptId}
                    >
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-[var(--app-text)]">
                          {row.studentName}
                        </p>
                        <p className="truncate text-xs text-muted">
                          {row.examTitle} · {row.subjectCode}
                        </p>
                      </div>
                      <ButtonLink
                        href={`/professor/grading/${row.attemptId}`}
                        size="sm"
                        variant="ghost"
                      >
                        تصحيح
                      </ButtonLink>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>موادي</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              {(data?.subjects.length ?? 0) === 0 ? (
                <div className="md:col-span-2">
                  <EmptyState
                    description="سيتم إسناد المواد إليك من مدير النظام."
                    title="لا توجد مواد مسندة إليك"
                  />
                </div>
              ) : (
                data?.subjects.map((subject) => (
                  <div
                    className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800"
                    key={subject.id}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-slate-800 dark:text-slate-100">{subject.name}</p>
                        <p className="text-xs text-slate-500">{subject.code}</p>
                      </div>
                      <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        {formatNumber(subject.students)} طالب
                      </span>
                    </div>

                    <div className="mt-4">
                      <div className="mb-2 flex items-center justify-between text-xs">
                        <span className="text-slate-500">نسبة الحضور</span>
                        <span className="font-medium text-slate-700 dark:text-slate-200">
                          {formatPercent(subject.attendance.percentage)} / الحد {formatPercent(subject.attendanceLimit, 0)}
                        </span>
                      </div>
                      <Progress
                        tone={attendanceTone(subject.attendance.percentage, subject.attendanceLimit)}
                        value={subject.attendance.percentage}
                      />
                    </div>

                    <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
                      <Metric label="حضور" tone="text-emerald-600" value={subject.attendance.present} />
                      <Metric label="غياب" tone="text-rose-600" value={subject.attendance.absent} />
                      <Metric label="بعذر" tone="text-amber-600" value={subject.attendance.excused} />
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>الامتحانات القادمة</CardTitle>
              </CardHeader>
              <CardContent>
                {(data?.upcomingExams.length ?? 0) === 0 ? (
                  <EmptyState description="لا توجد امتحانات منشورة قادمة." title="لا توجد امتحانات قادمة" />
                ) : (
                  <ul className="space-y-3">
                    {data?.upcomingExams.map((exam) => (
                      <li
                        className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60"
                        key={exam.id}
                      >
                        <div>
                          <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{exam.title}</p>
                          <p className="text-xs text-slate-500">{exam.subjectName}</p>
                        </div>
                        <span className="shrink-0 text-xs font-medium text-blue-700 dark:text-blue-300">
                          {formatDate(exam.startsAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>آخر المنشورات</CardTitle>
              </CardHeader>
              <CardContent>
                {(data?.recentAnnouncements.length ?? 0) === 0 ? (
                  <EmptyState description="لم تنشر أي إعلان في موادك بعد." title="لا توجد منشورات" />
                ) : (
                  <ul className="space-y-3">
                    {data?.recentAnnouncements.map((announcement) => (
                      <li
                        className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60"
                        key={announcement.id}
                      >
                        <div>
                          <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
                            {announcement.title}
                          </p>
                          <p className="text-xs text-slate-500">{announcement.subjectName}</p>
                        </div>
                        <span className="shrink-0 text-xs text-slate-400">
                          {formatDateTime(announcement.createdAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-amber-700 dark:text-amber-300">
                <AlertTriangle aria-hidden className="size-5" />
                طلاب يحتاجون إلى دعم
              </CardTitle>
            </CardHeader>
            <CardContent>
              {(data?.needsAttention.length ?? 0) === 0 ? (
                <EmptyState description="جميع الطلاب فوق الحد المطلوب للحضور." title="لا يوجد طلاب دون الحد" />
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {data?.needsAttention.map((entry, index) => (
                    <li className="flex items-center justify-between gap-4 py-3" key={`${entry.universityId}-${index}`}>
                      <div>
                        <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
                          {entry.studentName}
                        </p>
                        <p className="text-xs text-slate-500">
                          {entry.universityId} · {entry.subjectName}
                        </p>
                      </div>
                      <span className="shrink-0 text-sm font-semibold text-rose-600">
                        {formatPercent(entry.percentage)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </ProfessorShell>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800/60">
      <p className={`text-base font-bold ${tone}`}>{formatNumber(value)}</p>
      <p className="text-slate-500">{label}</p>
    </div>
  );
}
