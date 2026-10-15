import { CalendarDays, Clock, FileQuestion, GraduationCap, ListChecks, Timer } from "lucide-react";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { formatCountdown } from "@/lib/student-exams";
import { formatDateTime, formatNumber, formatPercent, formatScore } from "@/lib/format";
import { questionTypeLabels } from "@/lib/labels";
import { getStudentProfile } from "@/lib/student-auth";
import {
  getStudentExamBriefing,
  studentExamStateLabels,
  studentExamStateTones,
} from "@/lib/student-exams";

import { StudentShell } from "../../shell";
import { StartExamButton } from "../start-exam-button";

export default async function StudentExamBriefingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const profile = await getStudentProfile();
  const { id } = await params;
  const exam = await getStudentExamBriefing(profile.id, id);

  if (!exam) notFound();

  const facts = [
    { icon: ListChecks, label: "عدد الأسئلة", value: formatNumber(exam.questionsCount) },
    {
      icon: GraduationCap,
      label: "أسئلة اختيار من متعدد",
      value: formatNumber(exam.objectiveCount),
    },
    {
      icon: FileQuestion,
      label: "أسئلة كتابية",
      value: formatNumber(exam.subjectiveCount),
    },
    { icon: Timer, label: "مدة الامتحان", value: `${formatNumber(exam.durationMin)} دقيقة` },
    { icon: CalendarDays, label: "الدرجة الكلية", value: formatScore(exam.totalScore, 0) },
    {
      icon: Clock,
      label: "الوقت المتبقي",
      value:
        exam.state === "IN_PROGRESS" && exam.remainingSeconds !== null
          ? formatCountdown(exam.remainingSeconds)
          : "—",
    },
  ];

  return (
    <StudentShell
      subtitle={`${exam.subjectName} · ${exam.subjectCode}${
        exam.professorName ? ` · ${exam.professorName}` : ""
      }`}
      title={exam.title}
      userName={profile.fullName}
    >
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                {exam.title}
                <Badge tone={studentExamStateTones[exam.state]}>
                  {studentExamStateLabels[exam.state]}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {exam.description ? (
                <p className="text-sm leading-7 text-muted">{exam.description}</p>
              ) : (
                <EmptyState
                  description="لم يضف الأستاذ أي تعليمات لهذا الامتحان."
                  title="لا توجد تعليمات"
                />
              )}

              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {facts.map((fact) => (
                  <div
                    className="rounded-2xl bg-[var(--glass-bg)] p-3 ring-1 ring-inset ring-[var(--glass-border)]"
                    key={fact.label}
                  >
                    <dt className="flex items-center gap-1.5 text-xs text-muted">
                      <fact.icon aria-hidden className="size-3.5" />
                      {fact.label}
                    </dt>
                    <dd className="mt-1 text-sm font-bold text-[var(--app-text)]">{fact.value}</dd>
                  </div>
                ))}
              </dl>

              <div className="rounded-2xl bg-amber-500/10 p-4 text-sm leading-7 text-amber-900 ring-1 ring-inset ring-amber-500/25 dark:text-amber-200">
                <p className="font-bold">تعليمات الامتحان</p>
                <ul className="mt-2 list-inside list-disc space-y-1">
                  <li>
                    يبدأ وقت الامتحان فور الضغط على زر البدء ولا يمكن إعادته مرة أخرى.
                  </li>
                  <li>
                    يُقفل التسليم بعد {formatNumber(exam.durationMin)} دقيقة أو عند انتهاء وقت
                    الامتحان، أيهما أسبق.
                  </li>
                  <li>الأسئلة ذات الاختيار من متعدد تُصحح تلقائياً بعد التسليم مباشرة.</li>
                  <li>
                    {exam.subjectiveCount > 0
                      ? "الأسئلة الكتابية تُراجَع من قِبل الأستاذ قبل اعتماد النتيجة النهائية."
                      : "جميع أسئلة هذا الامتحان من النوع الموضوعي وتُصحح تلقائياً."}
                  </li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>حالة المحاولة</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {exam.attemptStatus ? (
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted">حالة المحاولة</span>
                    <Badge tone={studentExamStateTones[exam.state]}>
                      {studentExamStateLabels[exam.state]}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted">الأسئلة المجاب عنها</span>
                    <span className="font-semibold text-[var(--app-text)]">
                      {formatNumber(exam.answeredCount)} / {formatNumber(exam.questionsCount)}
                    </span>
                  </div>
                  {exam.attemptScore !== null && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted">الدرجة الحالية</span>
                      <span className="font-semibold text-[var(--app-text)]">
                        {formatScore(exam.attemptScore)} / {formatScore(exam.totalScore, 0)} ·{" "}
                        {formatPercent(
                          exam.totalScore > 0
                            ? (exam.attemptScore / exam.totalScore) * 100
                            : null,
                        )}
                      </span>
                    </div>
                  )}
                  {exam.submittedAt && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted">وقت التسليم</span>
                      <span className="font-semibold text-[var(--app-text)]">
                        {formatDateTime(exam.submittedAt)}
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm leading-7 text-muted">
                  لم تبدأ هذا الامتحان بعد. ستبدأ مؤقته فور الضغط على زر البدء.
                </p>
              )}

              <div className="space-y-2 border-t border-[var(--glass-border)] pt-4">
                {exam.state === "OPEN" && (
                  <StartExamButton
                    examId={exam.id}
                    hint="اضغط على الزر للبدء فوراً."
                    label="ابدأ الامتحان الآن"
                  />
                )}

                {(exam.state === "IN_PROGRESS" || exam.state === "EXPIRED") && (
                  <>
                    <ButtonLink className="w-full" href={`/student/exams/${exam.id}/attempt`} size="lg">
                      {exam.state === "IN_PROGRESS" ? "متابعة الإجابة" : "تسليم الإجابات المحفوظة"}
                    </ButtonLink>
                    <p className="text-xs text-muted">
                      {exam.state === "IN_PROGRESS"
                        ? "يمكنك العودة للامتحان في أي وقت قبل انتهاء الوقت."
                        : "انتهى وقت الامتحان. سلّم إجاباتك المحفوظة الآن."}
                    </p>
                  </>
                )}

                {(exam.state === "SUBMITTED" || exam.state === "GRADED") && (
                  <ButtonLink className="w-full" href={`/student/exams/${exam.id}/result`} size="lg">
                    {exam.state === "GRADED" ? "عرض النتيجة الكاملة" : "عرض حالة التسليم"}
                  </ButtonLink>
                )}

                {(exam.state === "UPCOMING" || exam.state === "CLOSED") && (
                  <>
                    <StartExamButton
                      disabled
                      examId={exam.id}
                      hint={
                        exam.state === "UPCOMING"
                          ? `يبدأ الامتحان في ${formatDateTime(exam.startsAt)}.`
                          : "انتهى موعد هذا الامتحان."
                      }
                      label={
                        exam.state === "UPCOMING" ? "لم يبدأ الامتحان بعد" : "الامتحان مغلق حالياً"
                      }
                    />
                  </>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>المواعيد</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted">بداية الامتحان</span>
                <span className="font-semibold text-[var(--app-text)]">
                  {formatDateTime(exam.startsAt)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted">نهاية الامتحان</span>
                <span className="font-semibold text-[var(--app-text)]">
                  {formatDateTime(exam.endsAt)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted">نوع الأسئلة</span>
                <span className="font-semibold text-[var(--app-text)]">
                  {exam.subjectiveCount > 0
                    ? `${exam.objectiveCount} اختيار · ${exam.subjectiveCount} كتابي`
                    : questionTypeLabels.MULTIPLE_CHOICE}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </StudentShell>
  );
}
