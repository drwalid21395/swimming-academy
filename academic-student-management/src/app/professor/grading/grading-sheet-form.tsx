"use client";

import { CheckCircle2, Save, XCircle } from "lucide-react";
import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Spinner } from "@/components/ui/loading";
import { formatNumber, formatScore } from "@/lib/format";
import { questionTypeLabels } from "@/lib/labels";
import type { GradingSheetRow } from "@/lib/professor-exams";

import { saveGradesAction, type GradingActionState } from "./actions";

const initialState: GradingActionState = { status: "idle" };

function scoreFieldName(questionId: string) {
  return `score.${questionId}`;
}

function feedbackFieldName(questionId: string) {
  return `feedback.${questionId}`;
}

function parseScore(value: string | undefined) {
  const trimmed = value?.trim() ?? "";
  if (trimmed === "") return Number.NaN;
  return Number(trimmed.replace(",", "."));
}

export function GradingSheetForm({
  attemptId,
  examId,
  rows,
  autoScore,
  possibleSubjective,
  totalScore,
}: {
  attemptId: string;
  examId: string;
  rows: GradingSheetRow[];
  autoScore: number;
  possibleSubjective: number;
  totalScore: number;
}) {
  const subjectiveRows = rows.filter((row) => !row.objective);
  const [state, formAction, pending] = useActionState(saveGradesAction, initialState);
  const [scores, setScores] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      subjectiveRows.map((row) => [row.questionId, row.awardedScore === null ? "" : String(row.awardedScore)]),
    ),
  );

  const subjectiveEarned = subjectiveRows.reduce((sum, row) => {
    const value = parseScore(scores[row.questionId]);
    if (Number.isNaN(value)) return sum;
    return sum + Math.min(row.maxScore, Math.max(0, value));
  }, 0);

  const completedCount = subjectiveRows.filter((row) => {
    const value = parseScore(scores[row.questionId]);
    return !Number.isNaN(value) && value >= 0 && value <= row.maxScore;
  }).length;

  const previewScore = autoScore + subjectiveEarned;
  const missing = subjectiveRows.length - completedCount;

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input name="attemptId" type="hidden" value={attemptId} />
      <input name="examId" type="hidden" value={examId} />

      <div className="sticky top-0 z-10 -mx-4 border-b border-[var(--glass-border)] bg-[var(--glass-bg-strong)] px-4 py-3 backdrop-blur-xl sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs text-muted">الدرجة النهائية بعد الحفظ</p>
            <p className="text-sm font-bold text-[var(--app-text)]">
              {formatScore(previewScore)} / {formatScore(totalScore, 0)} ·{" "}
              {formatNumber(completedCount)} من {formatNumber(subjectiveRows.length)} سؤال كتابي
            </p>
          </div>

          <Button disabled={pending || missing > 0} type="submit">
            {pending ? <Spinner /> : <Save aria-hidden className="size-4" />}
            {pending ? "جارٍ الحفظ..." : "اعتماد الدرجة النهائية"}
          </Button>
        </div>

        {missing > 0 && (
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-300" role="status">
            أدخل درجة لكل سؤال كتابي ({formatNumber(missing)} متبقٍ) قبل الاعتماد. الدرجة القصوى{" "}
            {formatScore(possibleSubjective, 0)} للأسئلة الكتابية.
          </p>
        )}

        {state.status === "success" && (
          <p className="mt-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300" role="status">
            {state.message} الدرجة المعتمدة {formatScore(state.score ?? 0)} /{" "}
            {formatScore(state.totalScore ?? totalScore, 0)}.
          </p>
        )}

        {state.status === "error" && (
          <p className="mt-2 text-xs font-semibold text-rose-600" role="alert">
            {state.message}
          </p>
        )}
      </div>

      {subjectiveRows.map((row) => (
        <section
          className="rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-4 backdrop-blur-xl sm:p-5"
          key={row.questionId}
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <h3 className="font-bold leading-7 text-[var(--app-text)]">
              <span className="me-2 text-brand-600 dark:text-brand-300">{row.position}.</span>
              {row.text}
            </h3>
            <span className="shrink-0 rounded-lg bg-slate-500/10 px-2.5 py-1 text-xs font-bold text-slate-600 dark:text-slate-300">
              {formatScore(row.maxScore, 0)} درجة
            </span>
          </div>

          <div className="rounded-2xl bg-[var(--glass-bg-strong)] p-3 text-sm leading-7 ring-1 ring-inset ring-[var(--glass-border)]">
            <p className="text-xs text-muted">إجابة الطالب</p>
            <p className="mt-1 whitespace-pre-wrap text-[var(--app-text)]">
              {row.studentAnswer?.trim() ? row.studentAnswer : "لم يجب الطالب عن هذا السؤال."}
            </p>
          </div>

          {(row.modelAnswer || row.explanation) && (
            <div className="mt-3 space-y-2">
              {row.modelAnswer && (
                <div className="rounded-2xl bg-emerald-500/8 p-3 text-sm leading-7 ring-1 ring-inset ring-emerald-500/20">
                  <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                    الإجابة النموذجية
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-[var(--app-text)]">{row.modelAnswer}</p>
                </div>
              )}
              {row.explanation && (
                <div className="rounded-2xl bg-[var(--glass-bg-strong)] p-3 text-sm leading-7 ring-1 ring-inset ring-[var(--glass-border)]">
                  <p className="text-xs font-semibold text-muted">شرح الإجابة</p>
                  <p className="mt-1 whitespace-pre-wrap text-[var(--app-text)]">{row.explanation}</p>
                </div>
              )}
            </div>
          )}

          <div className="mt-4 grid gap-4 sm:grid-cols-[10rem_1fr]">
            <Field
              hint={`من ${formatScore(row.maxScore, 0)}`}
              htmlFor={scoreFieldName(row.questionId)}
              label="الدرجة"
              required
            >
              <Input
                id={scoreFieldName(row.questionId)}
                max={row.maxScore}
                min={0}
                name={scoreFieldName(row.questionId)}
                onChange={(event) =>
                  setScores((current) => ({ ...current, [row.questionId]: event.target.value }))
                }
                placeholder="0"
                step="0.5"
                type="number"
                value={scores[row.questionId] ?? ""}
              />
            </Field>

            <Field
              hint="يظهر للطالب في صفحة النتيجة (حتى 2000 حرف)"
              htmlFor={feedbackFieldName(row.questionId)}
              label="ملاحظة للطالب"
            >
              <Textarea
                defaultValue={row.feedback ?? ""}
                id={feedbackFieldName(row.questionId)}
                maxLength={2000}
                name={feedbackFieldName(row.questionId)}
                placeholder="ملاحظات تصحيح اختيارية..."
              />
            </Field>
          </div>
        </section>
      ))}

      {rows.some((row) => row.objective) && (
        <section className="rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-4 backdrop-blur-xl sm:p-5">
          <h3 className="font-bold text-[var(--app-text)]">الأسئلة الموضوعية (مصححة آلياً)</h3>
          <ul className="mt-3 space-y-2">
            {rows
              .filter((row) => row.objective)
              .map((row) => (
                <li
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[var(--glass-bg-strong)] px-3 py-2 text-sm ring-1 ring-inset ring-[var(--glass-border)]"
                  key={row.questionId}
                >
                  <span className="text-[var(--app-text)]">
                    <span className="me-2 font-bold text-brand-600 dark:text-brand-300">
                      {row.position}.
                    </span>
                    {questionTypeLabels[row.type]}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-muted">
                      {formatScore(row.awardedScore ?? 0)} / {formatScore(row.maxScore, 0)}
                    </span>
                    {row.isCorrect === true ? (
                      <span className="inline-flex items-center gap-1 font-semibold text-emerald-700 dark:text-emerald-300">
                        <CheckCircle2 aria-hidden className="size-4" />
                        صحيحة
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 font-semibold text-rose-700 dark:text-rose-300">
                        <XCircle aria-hidden className="size-4" />
                        خاطئة
                      </span>
                    )}
                  </span>
                </li>
              ))}
          </ul>
        </section>
      )}
    </form>
  );
}
