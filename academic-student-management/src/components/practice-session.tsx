"use client";

import { CheckCircle2, ChevronLeft, Lightbulb, Shuffle, XCircle } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { PublicPracticeQuestion } from "@/lib/public-portal";

type Feedback = { correct: boolean; chosen: string } | null;

function normalize(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function matchesModel(userAnswer: string, modelAnswer: string | null) {
  if (!modelAnswer) return false;
  const user = normalize(userAnswer);
  const model = normalize(modelAnswer);
  if (!user || !model) return false;
  return user === model || model.includes(user) || user.includes(model);
}

export function PracticeSession({
  questions,
  doneLabel = "أسئلة أخرى",
  onDone,
  onExit,
}: {
  questions: PublicPracticeQuestion[];
  doneLabel?: string;
  onDone?: () => void;
  onExit?: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [chosen, setChosen] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [correctCount, setCorrectCount] = useState(0);
  const [finished, setFinished] = useState(false);

  const question = questions[index] ?? null;
  const isTrueFalse = question?.type === "TRUE_FALSE";
  const tfCorrect = isTrueFalse
    ? question.correctAnswer?.toLowerCase() === "true"
      ? "صح"
      : "خطأ"
    : null;

  const handleChoose = (optionText: string, isCorrect: boolean) => {
    if (feedback || !question) return;
    setChosen(optionText);
    setFeedback({ correct: isCorrect, chosen: optionText });
    if (isCorrect) setCorrectCount((count) => count + 1);
  };

  const handleCheck = () => {
    if (feedback || !question || !chosen.trim()) return;
    const correct = matchesModel(chosen, question.correctAnswer);
    setFeedback({ correct, chosen });
    if (correct) setCorrectCount((count) => count + 1);
  };

  const handleNext = () => {
    if (index + 1 >= questions.length) {
      setFinished(true);
      return;
    }
    setChosen("");
    setFeedback(null);
    setIndex((current) => current + 1);
  };

  if (finished) {
    const ratio = questions.length > 0 ? correctCount / questions.length : 0;
    return (
      <div className="rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-6 text-center">
        <p className="text-lg font-extrabold text-[var(--app-text)]">انتهت الجولة</p>
        <p className="mt-2 text-sm text-muted">
          أجبت إجابة صحيحة على {correctCount} من {questions.length} سؤال
        </p>
        <p className="mt-4 text-3xl font-black text-brand-700 dark:text-brand-300">
          {Math.round(ratio * 100)}%
        </p>
        {onDone && (
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            <Button onClick={onDone} type="button">
              <Shuffle aria-hidden className="size-4" />
              {doneLabel}
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-bold text-[var(--app-text)]">
          سؤال {index + 1} من {questions.length}
        </p>
        <span className="flex items-center gap-2">
          <span className="text-xs text-muted">إجابات صحيحة حتى الآن: {correctCount}</span>
          {onExit && (
            <button
              className="text-xs font-semibold text-muted underline-offset-4 hover:text-brand-600 hover:underline dark:hover:text-brand-300"
              onClick={onExit}
              type="button"
            >
              تغيير الاختيار
            </button>
          )}
        </span>
      </div>

      <section className="rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-4 backdrop-blur-xl sm:p-5">
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <Badge tone="blue">{question.typeLabel}</Badge>
          <Badge tone="neutral">{question.difficultyLabel}</Badge>
          {question.category && <Badge tone="violet">{question.category}</Badge>}
        </div>

        <h2 className="font-bold leading-7 text-[var(--app-text)]">{question.text}</h2>
        {question.unit && <p className="mt-1 text-xs text-muted">{question.unit}</p>}

        {question.options.length > 0 ? (
          <div className="mt-4 space-y-2">
            {question.options.map((option) => {
              const isChosen = feedback?.chosen === option.text;
              const tone = feedback
                ? option.isCorrect
                  ? "border-emerald-500/70 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200"
                  : isChosen
                    ? "border-rose-500/70 bg-rose-500/10 text-rose-800 dark:text-rose-200"
                    : "border-[var(--glass-border)] text-muted"
                : "border-[var(--glass-border)] text-muted hover:bg-[var(--glass-bg-strong)]";
              return (
                <button
                  className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition ${tone}`}
                  disabled={Boolean(feedback)}
                  key={option.id}
                  onClick={() => handleChoose(option.text, option.isCorrect)}
                  type="button"
                >
                  <span className="flex-1 text-start">{option.text}</span>
                  {feedback && option.isCorrect && (
                    <CheckCircle2 aria-hidden className="size-4 shrink-0 text-emerald-600" />
                  )}
                  {feedback && isChosen && !option.isCorrect && (
                    <XCircle aria-hidden className="size-4 shrink-0 text-rose-500" />
                  )}
                </button>
              );
            })}
          </div>
        ) : isTrueFalse ? (
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {["صح", "خطأ"].map((choice) => {
              const isChosen = feedback?.chosen === choice;
              const isCorrectOption = tfCorrect === choice;
              const tone = feedback
                ? isCorrectOption
                  ? "border-emerald-500/70 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200"
                  : isChosen
                    ? "border-rose-500/70 bg-rose-500/10 text-rose-800 dark:text-rose-200"
                    : "border-[var(--glass-border)] text-muted"
                : "border-[var(--glass-border)] text-muted hover:bg-[var(--glass-bg-strong)]";
              return (
                <button
                  className={`flex w-full items-center justify-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition ${tone}`}
                  disabled={Boolean(feedback)}
                  key={choice}
                  onClick={() => handleChoose(choice, isCorrectOption)}
                  type="button"
                >
                  {choice}
                  {feedback && isCorrectOption && (
                    <CheckCircle2 aria-hidden className="size-4 shrink-0 text-emerald-600" />
                  )}
                  {feedback && isChosen && !isCorrectOption && (
                    <XCircle aria-hidden className="size-4 shrink-0 text-rose-500" />
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <textarea
              className="min-h-28 w-full rounded-2xl border border-[var(--glass-border)] bg-[var(--field-bg)] px-4 py-3 text-sm leading-7 text-[var(--app-text)] backdrop-blur-xl focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/15"
              onChange={(event) => setChosen(event.target.value)}
              placeholder="اكتب إجابتك هنا ثم اضغط تحقق"
              value={chosen}
            />
            <Button disabled={Boolean(feedback) || !chosen.trim()} onClick={handleCheck} type="button">
              تحقق من الإجابة
            </Button>
          </div>
        )}

        {feedback && (
          <div
            className={`mt-4 rounded-2xl border p-4 text-sm ${
              feedback.correct
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200"
                : "border-rose-500/30 bg-rose-500/10 text-rose-800 dark:text-rose-200"
            }`}
            role="status"
          >
            <p className="flex items-center gap-2 font-bold">
              {feedback.correct ? (
                <>
                  <CheckCircle2 aria-hidden className="size-4" />
                  إجابة صحيحة
                </>
              ) : (
                <>
                  <XCircle aria-hidden className="size-4" />
                  إجابة غير صحيحة
                </>
              )}
            </p>

            {!feedback.correct && question.options.length === 0 && !isTrueFalse && question.correctAnswer && (
              <p className="mt-2 leading-7">
                <span className="font-semibold">الإجابة النموذجية: </span>
                {question.correctAnswer}
              </p>
            )}

            {!feedback.correct && isTrueFalse && (
              <p className="mt-2 leading-7">
                <span className="font-semibold">الإجابة النموذجية: </span>
                {tfCorrect}
              </p>
            )}

            {question.explanation && (
              <p className="mt-2 flex items-start gap-2 leading-7">
                <Lightbulb aria-hidden className="mt-0.5 size-4 shrink-0" />
                <span>{question.explanation}</span>
              </p>
            )}

            <div className="mt-3 text-end">
              <Button onClick={handleNext} size="sm" type="button" variant="secondary">
                {index + 1 >= questions.length ? "عرض النتيجة" : "السؤال التالي"}
                <ChevronLeft aria-hidden className="size-4" />
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}