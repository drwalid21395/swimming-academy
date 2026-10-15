import { CheckCircle2, ClipboardCheck, Clock, Hourglass, Trophy } from "lucide-react";
import { notFound, redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { StatCard } from "@/components/ui/stat-card";
import { formatDateTime, formatNumber, formatPercent, formatScore } from "@/lib/format";
import { attemptStatusLabels } from "@/lib/labels";
import { getGradingSheet } from "@/lib/professor-exams";
import { getProfessorProfile } from "@/lib/professor-auth";

import { ProfessorShell } from "../../shell";
import { GradingSheetForm } from "../grading-sheet-form";

export default async function ProfessorGradingSheetPage({
  params,
}: {
  params: Promise<{ attemptId: string }>;
}) {
  const profile = await getProfessorProfile();
  if (!profile.can("RESULTS_VIEW")) redirect("/unauthorized");
  const { attemptId } = await params;

  const sheet = await getGradingSheet(profile.subjectIds, attemptId);
  if (!sheet) notFound();

  const graded = sheet.status === "GRADED";

  return (
    <ProfessorShell
      grants={profile.grants}
      kind={profile.kind}
      subtitle={`${sheet.subjectName} · ${sheet.subjectCode} · ${sheet.studentName}`}
      title="تصحيح محاولة"
      userName={profile.fullName}
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          hint="تصحيح آلي للأسئلة الموضوعية"
          icon={ClipboardCheck}
          label="درجة الموضوعي"
          tone="blue"
          value={`${formatScore(sheet.autoScore)} / ${formatScore(sheet.totalScore, 0)}`}
        />
        <StatCard
          hint={`من ${formatScore(sheet.possibleSubjective, 0)}`}
          icon={Hourglass}
          label="الدرجة الممنوحة للكتابي"
          tone="amber"
          value={formatScore(sheet.awardedSubjective)}
        />
        <StatCard
          hint="بعد حفظ الدرجات"
          icon={Trophy}
          label="الدرجة النهائية"
          tone={graded ? "emerald" : "violet"}
          value={`${formatScore(sheet.finalScore)} / ${formatScore(sheet.totalScore, 0)}`}
        />
        <StatCard
          hint="من الأسئلة الكتابية"
          icon={CheckCircle2}
          label="أسئلة مصححة"
          tone={sheet.isComplete ? "emerald" : "rose"}
          value={`${formatNumber(sheet.gradedSubjectiveCount)} / ${formatNumber(sheet.subjectiveCount)}`}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            {sheet.examTitle}
            <Badge tone={graded ? "success" : "warning"}>{attemptStatusLabels[sheet.status]}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-muted">الطالب</span>
            <span className="font-bold text-[var(--app-text)]">
              {sheet.studentName} {sheet.universityId ? `· ${sheet.universityId}` : ""}
            </span>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-muted">الدرجة المسجلة</span>
            <span className="font-bold text-[var(--app-text)]">
              {formatScore(sheet.finalScore)} / {formatScore(sheet.totalScore, 0)} ·{" "}
              {formatPercent(
                sheet.totalScore === 0 ? null : (sheet.finalScore / sheet.totalScore) * 100,
              )}
            </span>
          </div>

          <Progress
            tone={graded ? "emerald" : "amber"}
            value={sheet.totalScore === 0 ? 0 : (sheet.finalScore / sheet.totalScore) * 100}
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl bg-[var(--glass-bg)] p-3 ring-1 ring-inset ring-[var(--glass-border)]">
              <p className="flex items-center gap-1.5 text-xs text-muted">
                <Clock aria-hidden className="size-3.5" />
                وقت البدء
              </p>
              <p className="mt-1 text-sm font-semibold text-[var(--app-text)]">
                {formatDateTime(sheet.startedAt)}
              </p>
            </div>
            <div className="rounded-2xl bg-[var(--glass-bg)] p-3 ring-1 ring-inset ring-[var(--glass-border)]">
              <p className="flex items-center gap-1.5 text-xs text-muted">
                <Clock aria-hidden className="size-3.5" />
                وقت التسليم
              </p>
              <p className="mt-1 text-sm font-semibold text-[var(--app-text)]">
                {sheet.submittedAt ? formatDateTime(sheet.submittedAt) : "—"}
              </p>
            </div>
          </div>

          {graded && (
            <p className="rounded-2xl bg-amber-500/10 px-4 py-3 text-sm leading-7 text-amber-900 ring-1 ring-inset ring-amber-500/25 dark:text-amber-200">
              هذه المحاولة معتمدة والدرجة ظاهرة للطالب. يمكنك تعديل الدرجات مرة أخرى عند الحاجة.
            </p>
          )}
        </CardContent>
      </Card>

      {sheet.subjectiveCount === 0 ? (
        <Card>
          <CardContent>
            <p className="text-sm leading-7 text-muted">
              كل أسئلة هذا الامتحان موضوعية وتم تصحيحها آلياً، فلا حاجة لتصحيح يدوي.
            </p>
          </CardContent>
        </Card>
      ) : (
        <GradingSheetForm
          attemptId={sheet.attemptId}
          autoScore={sheet.autoScore}
          examId={sheet.examId}
          possibleSubjective={sheet.possibleSubjective}
          rows={sheet.rows}
          totalScore={sheet.totalScore}
        />
      )}

      <div className="flex flex-wrap justify-center gap-2">
        <ButtonLink href="/professor/grading" variant="secondary">
          العودة لقائمة التصحيح
        </ButtonLink>
        <ButtonLink href={`/professor/exams/${sheet.examId}`} variant="ghost">
          تفاصيل الامتحان
        </ButtonLink>
      </div>
    </ProfessorShell>
  );
}
