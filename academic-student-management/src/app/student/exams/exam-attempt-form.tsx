"use client";

import { Save, Send, Timer, TriangleAlert } from "lucide-react";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";

import { QuestionStudentView } from "@/components/questions/question-student-view";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/loading";
import type { AttemptQuestionView } from "@/lib/student-exams";

import { saveAnswersAction, submitExamAction, type AttemptActionState } from "./actions";

const initialState: AttemptActionState = { status: "idle" };

function answerFieldName(questionId: string) {
  return `answer.${questionId}`;
}

export function ExamAttemptForm({
  attemptId,
  examId,
  title,
  questions,
  initialAnswers,
  initialRemainingSeconds,
}: {
  attemptId: string;
  examId: string;
  title: string;
  questions: AttemptQuestionView[];
  initialAnswers: Record<string, string>;
  initialRemainingSeconds: number;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>(initialAnswers);
  const [remaining, setRemaining] = useState(initialRemainingSeconds);
  const [saveState, setSaveState] = useState<{ ok: boolean; message?: string; saved: boolean }>({
    ok: true,
    saved: false,
  });
  const [saving, startSaving] = useTransition();
  const [submitState, submitFormAction, submitting] = useActionState(submitExamAction, initialState);
  const [confirming, setConfirming] = useState(false);
  const autoSubmitted = useRef(false);

  const answeredCount = questions.filter((question) => answers[question.questionId]?.trim()).length;
  const total = questions.length;

  useEffect(() => {
    if (initialRemainingSeconds <= 0) return;

    const timer = window.setInterval(() => {
      setRemaining((value) => Math.max(0, value - 1));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [initialRemainingSeconds]);

  useEffect(() => {
    if (remaining > 0 || autoSubmitted.current) return;
    autoSubmitted.current = true;
    (document.getElementById("attempt-form") as HTMLFormElement | null)?.requestSubmit();
  }, [remaining]);

  const buildPayload = () => {
    const formData = new FormData();
    formData.set("attemptId", attemptId);

    for (const question of questions) {
      const value = answers[question.questionId];
      if (value) formData.set(answerFieldName(question.questionId), value);
    }

    return formData;
  };

  const handleSave = () => {
    startSaving(async () => {
      const result = await saveAnswersAction(buildPayload());
      setSaveState({ ok: result.ok, message: result.message, saved: result.ok });
    });
  };

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const urgent = remaining <= 300;

  return (
    <form action={submitFormAction} className="space-y-6" id="attempt-form" noValidate>
      <input name="attemptId" type="hidden" value={attemptId} />
      <input name="examId" type="hidden" value={examId} />

      <div className="sticky top-0 z-10 -mx-4 border-b border-[var(--glass-border)] bg-[var(--glass-bg-strong)] px-4 py-3 backdrop-blur-xl sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs text-muted">{title}</p>
            <p className="text-sm font-bold text-[var(--app-text)]">
              أجبت على {answeredCount} من {total} سؤال
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-bold ring-1 ring-inset ${
                urgent
                  ? "bg-rose-500/12 text-rose-700 ring-rose-500/25 dark:text-rose-300"
                  : "bg-brand-500/12 text-brand-700 ring-brand-500/25 dark:text-brand-200"
              }`}
            >
              <Timer aria-hidden className="size-4" />
              {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
            </span>

            <Button
              disabled={saving}
              onClick={handleSave}
              size="sm"
              type="button"
              variant="secondary"
            >
              {saving ? <Spinner /> : <Save aria-hidden className="size-4" />}
              {saving ? "جارٍ الحفظ..." : "حفظ مؤقت"}
            </Button>

            <Button
              disabled={submitting}
              onClick={() => setConfirming(true)}
              size="sm"
              type="button"
            >
              {submitting ? <Spinner /> : <Send aria-hidden className="size-4" />}
              تسليم الامتحان
            </Button>
          </div>
        </div>

        <p className="mt-2 text-xs text-muted" role="status">
          {saveState.ok
            ? saveState.saved
              ? "تم حفظ إجاباتك مؤقتاً."
              : "احفظ إجاباتك قبل تسليم الامتحان."
            : saveState.message}
        </p>
      </div>

      {submitState.status === "error" && submitState.message && (
        <p
          className="rounded-2xl bg-rose-500/12 px-4 py-3 text-sm font-semibold text-rose-700 ring-1 ring-inset ring-rose-500/25 dark:text-rose-300"
          role="alert"
        >
          {submitState.message}
        </p>
      )}

      {questions.map((question) => {
        const fieldName = answerFieldName(question.questionId);
        const value = answers[question.questionId] ?? "";

        return (
          <QuestionStudentView
            fieldName={fieldName}
            key={question.questionId}
            onAnswerChange={(nextValue) =>
              setAnswers((current) => ({ ...current, [question.questionId]: nextValue }))
            }
            options={question.options}
            position={question.position}
            score={question.score}
            text={question.text}
            unit={question.unit}
            value={value}
          />
        );
      })}

      {confirming && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg-strong)] p-5 shadow-2xl">
            <h3 className="flex items-center gap-2 font-bold text-[var(--app-text)]">
              <TriangleAlert aria-hidden className="size-5 text-amber-500" />
              تأكيد تسليم الامتحان
            </h3>
            <p className="mt-2 text-sm leading-7 text-muted">
              أجبت على {answeredCount} من {total} سؤال. بعد التسليم لن تتمكن من تعديل الإجابات.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button onClick={() => setConfirming(false)} type="button" variant="secondary">
                مراجعة الإجابات
              </Button>
              <Button
                onClick={() => {
                  setConfirming(false);
                  (document.getElementById("attempt-form") as HTMLFormElement | null)?.requestSubmit();
                }}
                type="button"
              >
                تأكيد التسليم
              </Button>
            </div>
          </div>
        </div>
      )}
    </form>
  );
}
