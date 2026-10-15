import { CheckCircle2, CircleSlash, Clock, Hourglass, ListChecks, Trophy, XCircle } from "lucide-react";
import { redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { StatCard } from "@/components/ui/stat-card";
import { formatDateTime, formatNumber, formatPercent, formatScore } from "@/lib/format";
import { attemptStatusLabels, questionTypeLabels } from "@/lib/labels";
import { getStudentProfile } from "@/lib/student-auth";
import {
  getStudentAttemptForExam,
  getStudentAttemptResult,
  isObjectiveQuestion,
  studentExamStateLabels,
  studentExamStateTones,
} from "@/lib/student-exams";

import { StudentShell } from "../../../shell";

export default async function StudentExamResultPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const profile = await getStudentProfile();
  const { id: examId } = await params;

  const attempt = await getStudentAttemptForExam(profile.id, examId);
  if (!attempt) redirect(`/student/exams/${examId}`);

  const result = await getStudentAttemptResult(profile.id, attempt.id);
  if (!result) redirect("/student/exams");

  const graded = result.status === "GRADED";

  return (
    <StudentShell
      subtitle={`${result.subjectName} · ${result.subjectCode}`}
      title="نتيجة الامتحان"
      userName={profile.fullName}
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          hint={`من ${formatScore(result.totalScore, 0)} درجة`}
          icon={Trophy}
          label="درجتك"
          tone={graded ? "emerald" : "amber"}
          value={`${formatScore(result.score)} / ${formatScore(result.totalScore, 0)}`}
        />
        <StatCard
          hint="نسبة الدرجة الكلية"
          icon={ListChecks}
          label="النسبة المئوية"
          tone="blue"
          value={formatPercent(result.percentage)}
        />
        <StatCard
          hint="تمت تصحيحها آلياً"
          icon={CheckCircle2}
          label="إجابات صحيحة"
          tone="emerald"
          value={formatNumber(result.summary.correct)}
        />
        <StatCard
          hint={graded ? "مكتملة" : "بانتظار تصحيح الأستاذ"}
          icon={Hourglass}
          label="إجابات خاطئة"
          tone="rose"
          value={formatNumber(result.summary.wrong)}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            {result.title}
            <Badge tone={studentExamStateTones[graded ? "GRADED" : "SUBMITTED"]}>
              {graded
                ? studentExamStateLabels.GRADED
                : `${attemptStatusLabels.SUBMITTED} · بانتظار المراجعة`}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-muted">الدرجة النهائية</span>
            <span className="font-bold text-[var(--app-text)]">
              {formatScore(result.score)} / {formatScore(result.totalScore, 0)} ·{" "}
              {formatPercent(result.percentage)}
            </span>
          </div>
          <Progress tone={graded ? "emerald" : "amber"} value={result.percentage ?? 0} />

          <dl className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl bg-[var(--glass-bg)] p-3 ring-1 ring-inset ring-[var(--glass-border)]">
              <dt className="flex items-center gap-1.5 text-xs text-muted">
                <Clock aria-hidden className="size-3.5" />
                وقت البدء
              </dt>
              <dd className="mt-1 text-sm font-semibold text-[var(--app-text)]">
                {formatDateTime(result.startedAt)}
              </dd>
            </div>
            <div className="rounded-2xl bg-[var(--glass-bg)] p-3 ring-1 ring-inset ring-[var(--glass-border)]">
              <dt className="flex items-center gap-1.5 text-xs text-muted">
                <CheckCircle2 aria-hidden className="size-3.5" />
                وقت التسليم
              </dt>
              <dd className="mt-1 text-sm font-semibold text-[var(--app-text)]">
                {result.submittedAt ? formatDateTime(result.submittedAt) : "—"}
                {result.usedMinutes ? ` · ${formatNumber(result.usedMinutes)} دقيقة` : ""}
              </dd>
            </div>
            <div className="rounded-2xl bg-[var(--glass-bg)] p-3 ring-1 ring-inset ring-[var(--glass-border)]">
              <dt className="flex items-center gap-1.5 text-xs text-muted">
                <CircleSlash aria-hidden className="size-3.5" />
                أسئلة لم تُصحح
              </dt>
              <dd className="mt-1 text-sm font-semibold text-[var(--app-text)]">
                {formatNumber(result.summary.pending)}
              </dd>
            </div>
          </dl>

          {!graded && (
            <p className="rounded-2xl bg-amber-500/10 px-4 py-3 text-sm leading-7 text-amber-900 ring-1 ring-inset ring-amber-500/25 dark:text-amber-200">
              تم تصحيح الأسئلة الموضوعية آلياً. سيتم اعتماد درجتك النهائية بعد مراجعة الأستاذ
              للأسئلة الكتابية.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="space-y-4">
        <h2 className="font-bold text-[var(--app-text)]">مراجعة الأسئلة</h2>

        {result.rows.map((row) => {
          const objective = isObjectiveQuestion(row.type);
          const correct = row.isCorrect === true;
          const wrong = row.isCorrect === false;

          return (
            <Card key={row.questionId}>
              <CardContent className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-bold leading-7 text-[var(--app-text)]">
                      <span className="me-2 text-brand-600 dark:text-brand-300">
                        {row.position}.
                      </span>
                      {row.text}
                    </h3>
                    <p className="mt-1 text-xs text-muted">
                      {questionTypeLabels[row.type]} · {formatScore(row.maxScore, 0)} درجة
                    </p>
                  </div>

                  {wrong ? (
                    <Badge tone="danger">
                      <XCircle aria-hidden className="size-3.5" />
                      إجابة خاطئة
                    </Badge>
                  ) : correct ? (
                    <Badge tone="success">
                      <CheckCircle2 aria-hidden className="size-3.5" />
                      إجابة صحيحة
                    </Badge>
                  ) : (
                    <Badge tone="warning">
                      <Hourglass aria-hidden className="size-3.5" />
                      بانتظار التصحيح
                    </Badge>
                  )}
                </div>

                {row.options.length > 0 && (
                  <ul className="space-y-1.5">
                    {row.options.map((option) => {
                      const chosen = row.studentAnswer === option.text;
                      const isAnswerKey = result.revealAnswers && option.isCorrect;

                      return (
                        <li
                          className={`flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm ring-1 ring-inset ${
                            isAnswerKey
                              ? "bg-emerald-500/10 font-semibold text-emerald-700 ring-emerald-500/25 dark:text-emerald-300"
                              : chosen
                                ? "bg-rose-500/10 font-semibold text-rose-700 ring-rose-500/25 dark:text-rose-300"
                                : "text-muted ring-[var(--glass-border)]"
                          }`}
                          key={option.id}
                        >
                          <span>{option.text}</span>
                          {isAnswerKey && <span className="text-xs">الإجابة الصحيحة</span>}
                          {chosen && !isAnswerKey && <span className="text-xs">إجابتك</span>}
                        </li>
                      );
                    })}
                  </ul>
                )}

                {!objective && (
                  <div className="rounded-2xl bg-[var(--glass-bg)] p-3 text-sm leading-7 ring-1 ring-inset ring-[var(--glass-border)]">
                    <p className="text-xs text-muted">إجابتك</p>
                    <p className="mt-1 whitespace-pre-wrap text-[var(--app-text)]">
                      {row.studentAnswer || "لم تُجب عن هذا السؤال."}
                    </p>
                  </div>
                )}

                {result.revealAnswers && row.modelAnswer && (
                  <div className="rounded-2xl bg-emerald-500/8 p-3 text-sm ring-1 ring-inset ring-emerald-500/20">
                    <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                      الإجابة النموذجية
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-[var(--app-text)]">
                      {row.modelAnswer}
                    </p>
                  </div>
                )}

                {result.revealAnswers && row.explanation && (
                  <div className="rounded-2xl bg-[var(--glass-bg)] p-3 text-sm leading-7 ring-1 ring-inset ring-[var(--glass-border)]">
                    <p className="text-xs font-semibold text-muted">شرح الإجابة</p>
                    <p className="mt-1 whitespace-pre-wrap text-[var(--app-text)]">
                      {row.explanation}
                    </p>
                  </div>
                )}

                {row.feedback && (
                  <div className="rounded-2xl bg-brand-500/8 p-3 text-sm leading-7 ring-1 ring-inset ring-brand-500/20">
                    <p className="text-xs font-semibold text-brand-700 dark:text-brand-200">
                      ملاحظة الأستاذ
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-[var(--app-text)]">
                      {row.feedback}
                    </p>
                  </div>
                )}

                <p className="text-xs font-semibold text-muted">
                  الدرجة على هذا السؤال: {formatScore(row.awardedScore ?? 0)} /{" "}
                  {formatScore(row.maxScore, 0)}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="flex flex-wrap justify-center gap-2">
        <ButtonLink href="/student/exams" variant="secondary">
          العودة لقائمة الامتحانات
        </ButtonLink>
        <ButtonLink href={`/student/exams/${examId}`} variant="ghost">
          تفاصيل الامتحان
        </ButtonLink>
      </div>
    </StudentShell>
  );
}
