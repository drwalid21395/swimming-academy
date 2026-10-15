import { CheckCircle2, ClipboardCheck, Clock, FileText, Hourglass, Users } from "lucide-react";
import { notFound, redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/states";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDateTime, formatNumber, formatPercent, formatScore } from "@/lib/format";
import { attemptStatusLabels, examStatusLabels, questionTypeLabels } from "@/lib/labels";
import { getProfessorExamDetail } from "@/lib/professor-exams";
import { getProfessorProfile } from "@/lib/professor-auth";
import { isObjectiveQuestion } from "@/lib/student-exams";

import { ProfessorShell } from "../../shell";

const statusTones = {
  DRAFT: "neutral",
  PUBLISHED: "success",
  CLOSED: "warning",
  ARCHIVED: "blue",
} as const;

const attemptTones = {
  IN_PROGRESS: "info",
  SUBMITTED: "warning",
  GRADED: "success",
} as const;

export default async function ProfessorExamDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const profile = await getProfessorProfile();
  if (!profile.can("EXAMS_MANAGE")) redirect("/unauthorized");
  const { id: examId } = await params;

  const exam = await getProfessorExamDetail(profile.subjectIds, examId);
  if (!exam) notFound();

  const canViewResults = profile.can("RESULTS_VIEW");
  const inProgress = exam.attempts.filter((attempt) => attempt.status === "IN_PROGRESS").length;

  return (
    <ProfessorShell
      grants={profile.grants}
      kind={profile.kind}
      subtitle={`${exam.subjectName} · ${exam.subjectCode}`}
      title="تفاصيل الامتحان"
      userName={profile.fullName}
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          hint="في هذه المحاولة"
          icon={Users}
          label="عدد المحاولات"
          tone="blue"
          value={formatNumber(exam.attempts.length)}
        />
        <StatCard
          hint="تحتاج تصحيحك"
          icon={Hourglass}
          label="بانتظار التصحيح"
          tone="amber"
          value={formatNumber(exam.pendingCount)}
        />
        <StatCard
          hint="تم اعتماد درجاتها"
          icon={CheckCircle2}
          label="محاولات مصححة"
          tone="emerald"
          value={formatNumber(exam.gradedCount)}
        />
        <StatCard
          hint={`من ${formatScore(exam.totalScore, 0)} درجة`}
          icon={ClipboardCheck}
          label="متوسط الدرجات"
          tone="violet"
          value={formatPercent(exam.averagePercentage)}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            {exam.title}
            <Badge tone={statusTones[exam.status as keyof typeof statusTones] ?? "neutral"}>
              {examStatusLabels[exam.status as keyof typeof examStatusLabels] ?? exam.status}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {exam.description && (
            <p className="text-sm leading-7 text-muted">{exam.description}</p>
          )}

          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl bg-[var(--glass-bg)] p-3 ring-1 ring-inset ring-[var(--glass-border)]">
              <dt className="flex items-center gap-1.5 text-xs text-muted">
                <Clock aria-hidden className="size-3.5" />
                بداية الامتحان
              </dt>
              <dd className="mt-1 text-sm font-semibold text-[var(--app-text)]">
                {formatDateTime(exam.startsAt)}
              </dd>
            </div>
            <div className="rounded-2xl bg-[var(--glass-bg)] p-3 ring-1 ring-inset ring-[var(--glass-border)]">
              <dt className="flex items-center gap-1.5 text-xs text-muted">
                <Clock aria-hidden className="size-3.5" />
                نهاية الامتحان
              </dt>
              <dd className="mt-1 text-sm font-semibold text-[var(--app-text)]">
                {formatDateTime(exam.endsAt)}
              </dd>
            </div>
            <div className="rounded-2xl bg-[var(--glass-bg)] p-3 ring-1 ring-inset ring-[var(--glass-border)]">
              <dt className="flex items-center gap-1.5 text-xs text-muted">
                <FileText aria-hidden className="size-3.5" />
                المدة والدرجة
              </dt>
              <dd className="mt-1 text-sm font-semibold text-[var(--app-text)]">
                {formatNumber(exam.durationMin)} دقيقة · {formatScore(exam.totalScore, 0)} درجة
              </dd>
            </div>
            <div className="rounded-2xl bg-[var(--glass-bg)] p-3 ring-1 ring-inset ring-[var(--glass-border)]">
              <dt className="flex items-center gap-1.5 text-xs text-muted">
                <Users aria-hidden className="size-3.5" />
                منشئ الامتحان
              </dt>
              <dd className="mt-1 text-sm font-semibold text-[var(--app-text)]">
                {exam.createdByName ?? "—"}
              </dd>
            </div>
          </dl>

          <div>
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="text-muted">أسئلة الامتحان</span>
              <span className="font-medium text-[var(--app-text)]">
                {formatNumber(exam.questions.length)} سؤال
              </span>
            </div>
            <ul className="space-y-2">
              {exam.questions.map((question) => (
                <li
                  className="flex items-start justify-between gap-3 rounded-2xl bg-[var(--glass-bg)] p-3 text-sm ring-1 ring-inset ring-[var(--glass-border)]"
                  key={question.id}
                >
                  <span className="text-[var(--app-text)]">
                    <span className="me-2 font-bold text-brand-600 dark:text-brand-300">
                      {question.position}.
                    </span>
                    {question.text}
                  </span>
                  <span className="shrink-0 text-xs text-muted">
                    {questionTypeLabels[question.type]} · {formatScore(question.score, 0)} درجة
                    {!isObjectiveQuestion(question.type) && " · يحتاج تصحيحاً يدوياً"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>

      {canViewResults ? (
        <Card>
          <CardHeader>
            <CardTitle>محاولات الطلاب</CardTitle>
          </CardHeader>
        <CardContent>
          {exam.attempts.length === 0 ? (
            <EmptyState description="لم يبدأ أي طالب هذا الامتحان بعد." title="لا توجد محاولات" />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>الطالب</TH>
                  <TH>الرقم الجامعي</TH>
                  <TH>الحالة</TH>
                  <TH>وقت التسليم</TH>
                  <TH>الإجابات</TH>
                  <TH>الدرجة</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {exam.attempts.map((attempt) => (
                  <TR key={attempt.id}>
                    <TD className="font-semibold text-[var(--app-text)]">{attempt.studentName}</TD>
                    <TD className="text-sm text-muted">{attempt.universityId ?? "—"}</TD>
                    <TD>
                      <Badge tone={attemptTones[attempt.status]}>
                        {attemptStatusLabels[attempt.status]}
                      </Badge>
                    </TD>
                    <TD className="whitespace-nowrap text-sm text-muted">
                      {attempt.submittedAt ? formatDateTime(attempt.submittedAt) : "لم يسلّم بعد"}
                    </TD>
                    <TD className="text-sm">
                      {formatNumber(attempt.answeredCount)}
                      {attempt.unansweredCount > 0 && (
                        <span className="text-xs text-muted">
                          {" "}
                          · {formatNumber(attempt.unansweredCount)} بدون إجابة
                        </span>
                      )}
                    </TD>
                    <TD className="min-w-28">
                      {attempt.status === "GRADED" ? (
                        <>
                          <Progress tone="emerald" value={attempt.percentage ?? 0} />
                          <p className="mt-1 text-xs text-muted">
                            {formatScore(attempt.score ?? 0)} / {formatScore(exam.totalScore, 0)} ·{" "}
                            {formatPercent(attempt.percentage)}
                          </p>
                        </>
                      ) : (
                        <span className="text-sm text-muted">—</span>
                      )}
                    </TD>
                    <TD>
                      {attempt.status === "SUBMITTED" ? (
                        <ButtonLink
                          href={`/professor/grading/${attempt.id}`}
                          size="sm"
                          variant="secondary"
                        >
                          تصحيح
                        </ButtonLink>
                      ) : attempt.status === "GRADED" ? (
                        <ButtonLink
                          href={`/professor/grading/${attempt.id}`}
                          size="sm"
                          variant="ghost"
                        >
                          عرض
                        </ButtonLink>
                      ) : (
                        <span className="text-xs text-muted">قيد الإجابة ({formatNumber(inProgress)})</span>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>محاولات الطلاب</CardTitle>
          </CardHeader>
          <CardContent>
            <EmptyState
              description="لم تُمنح صلاحية «مشاهدة النتائج» لحسابك، لذا لا يمكن عرض محاولات الطلاب ودرجاتهم."
              title="النتائج غير متاحة"
            />
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap justify-center gap-2">
        <ButtonLink href="/professor/exams" variant="secondary">
          العودة لقائمة الامتحانات
        </ButtonLink>
        {canViewResults && (
          <ButtonLink href="/professor/grading" variant="ghost">
            قائمة التصحيح
          </ButtonLink>
        )}
      </div>
    </ProfessorShell>
  );
}
