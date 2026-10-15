import { BookOpen, CalendarCheck, FileQuestion, TrendingUp } from "lucide-react";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { attendanceTone, Progress } from "@/components/ui/progress";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState, QueryErrorState } from "@/components/ui/states";
import { authOptions } from "@/auth";
import { getStudentOverview } from "@/lib/dashboard-data";
import { formatDate, formatDateTime, formatNumber, formatPercent, formatScore } from "@/lib/format";

import { StudentShell } from "./shell";

export default async function StudentDashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/sign-in");

  const overview = await getStudentOverview(session.user.id);
  const data = overview.ok ? overview.data : null;

  const trackedSubjects = data?.subjects.filter((subject) => subject.attendance.percentage !== null) ?? [];
  const overallAttendance = trackedSubjects.length
    ? trackedSubjects.reduce((sum, subject) => sum + (subject.attendance.percentage ?? 0), 0) /
      trackedSubjects.length
    : null;

  return (
    <StudentShell
      subtitle={
        data?.departmentName
          ? [
              data.departmentName,
              data.specializationName ? `التخصص: ${data.specializationName}` : null,
              `الفرقة ${formatNumber(data.academicYear ?? 0)}`,
              `الرقم الجامعي ${data.universityId ?? "—"}`,
            ]
              .filter(Boolean)
              .join(" · ")
          : "متابعة موادك وحضورك ودرجاتك"
      }
      title="لوحة تحكم الطالب"
      userName={session.user.name ?? "طالب"}
    >
      {!overview.ok ? (
        <QueryErrorState message={overview.message} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              icon={BookOpen}
              label="المواد المسجل بها"
              tone="blue"
              value={formatNumber(data?.subjects.length ?? 0)}
            />
            <StatCard
              icon={CalendarCheck}
              label="نسبة الحضور"
              tone={attendanceTone(overallAttendance)}
              value={formatPercent(overallAttendance)}
            />
            <StatCard
              icon={FileQuestion}
              label="امتحانات تم تصحيحها"
              tone="emerald"
              value={formatNumber(data?.grades.length ?? 0)}
            />
            <StatCard
              icon={TrendingUp}
              label="متوسط الدرجات"
              tone="amber"
              value={formatPercent(data?.overallAverage ?? null)}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>موادي ومتابعة الحضور</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              {(data?.subjects.length ?? 0) === 0 ? (
                <div className="md:col-span-2">
                  <EmptyState description="سيظهر هنا توزيعك للمواد بعد تسجيلها." title="لا توجد مواد مسجلة" />
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
                        <p className="text-xs text-slate-500">
                          {subject.code} {subject.professorName ? `· ${subject.professorName}` : ""}
                        </p>
                      </div>
                      <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        {formatNumber(subject.examsCount)} امتحان
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

                    <div className="mt-4 flex items-center justify-between text-xs">
                      <span className="text-slate-500">متوسط درجات المادة</span>
                      <span className="font-semibold text-slate-800 dark:text-slate-100">
                        {formatPercent(subject.averageScore)}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>نتائج الامتحانات</CardTitle>
              </CardHeader>
              <CardContent>
                {(data?.grades.length ?? 0) === 0 ? (
                  <EmptyState description="ستظهر نتائجك بعد تصحيح الامتحانات." title="لا توجد نتائج بعد" />
                ) : (
                  <ul className="space-y-3">
                    {data?.grades.map((grade) => (
                      <li
                        className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60"
                        key={grade.attemptId}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
                              {grade.examTitle}
                            </p>
                            <p className="text-xs text-slate-500">
                              {grade.subjectName}
                              {grade.submittedAt ? ` · ${formatDate(grade.submittedAt)}` : ""}
                            </p>
                          </div>
                          <div className="text-left">
                            <p className="text-sm font-bold text-slate-900 dark:text-slate-50">
                              {formatScore(grade.score)} / {formatScore(grade.totalScore, 0)}
                            </p>
                            <p className="text-xs font-medium text-blue-700 dark:text-blue-300">
                              {formatPercent(grade.percentage)}
                            </p>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>آخر الأخبار</CardTitle>
              </CardHeader>
              <CardContent>
                {(data?.announcements.length ?? 0) === 0 ? (
                  <EmptyState description="لا توجد إعلانات في موادك حالياً." title="لا توجد أخبار" />
                ) : (
                  <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                    {data?.announcements.map((announcement) => (
                      <li className="py-3" key={announcement.id}>
                        <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
                          {announcement.title}
                        </p>
                        <p className="text-xs text-slate-500">
                          {announcement.subjectName} · {formatDateTime(announcement.createdAt)}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </StudentShell>
  );
}
