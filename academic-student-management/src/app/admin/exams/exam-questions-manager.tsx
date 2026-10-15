"use client";

import { Library, Plus, Save, Trash2 } from "lucide-react";
import { useActionState, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Spinner } from "@/components/ui/loading";
import { Modal } from "@/components/ui/modal";
import type { BankQuestion, ExamQuestionItem } from "@/lib/exams";
import { difficultyLabels, questionTypeLabels } from "@/lib/labels";

import {
  attachQuestionsAction,
  removeExamQuestionAction,
  updateQuestionScoreAction,
  type ExamQuestionActionState,
} from "./question-actions";

const initialState: ExamQuestionActionState = { status: "idle" };

const difficultyTone = {
  EASY: "success",
  MEDIUM: "warning",
  HARD: "danger",
} as const;

function AddQuestionsDialog({
  examId,
  bank,
  attachedIds,
}: {
  examId: string;
  bank: BankQuestion[];
  attachedIds: string[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [state, formAction, pending] = useActionState(attachQuestionsAction, initialState);

  const attached = useMemo(() => new Set(attachedIds), [attachedIds]);
  const filtered = bank.filter(
    (question) =>
      !attached.has(question.id) && question.text.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm">
        <Plus aria-hidden className="size-4" />
        إضافة أسئلة من البنك
      </Button>

      <Modal
        description="اختر الأسئلة المراد إضافتها إلى هذا الامتحان، ثم حدد درجة كل سؤال بعد الإضافة."
        onClose={() => setOpen(false)}
        open={open}
        size="lg"
        title="إضافة أسئلة من بنك الأسئلة"
      >
        <form action={formAction} className="space-y-4">
          <input name="examId" type="hidden" value={examId} />

          <Input
            onChange={(event) => setQuery(event.target.value)}
            placeholder="ابحث في نص السؤال"
            type="search"
            value={query}
          />

          <div className="max-h-80 space-y-2 overflow-y-auto pl-1">
            {filtered.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-[var(--glass-border)] px-4 py-8 text-center text-sm text-muted">
                لا توجد أسئلة متاحة. أضف أسئلة إلى بنك الأسئلة أولاً.
              </p>
            ) : (
              filtered.map((question) => (
                <label
                  className="row-hover flex cursor-pointer items-start gap-3 rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] px-4 py-3"
                  key={question.id}
                >
                  <input
                    checked={selected.includes(question.id)}
                    className="mt-1 size-4 accent-brand-600"
                    name="questionId"
                    onChange={(event) =>
                      setSelected((current) =>
                        event.target.checked
                          ? [...current, question.id]
                          : current.filter((id) => id !== question.id),
                      )
                    }
                    type="checkbox"
                    value={question.id}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold leading-6 text-[var(--app-text)]">
                      {question.text}
                    </span>
                    <span className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                      <Badge tone="blue">{questionTypeLabels[question.type]}</Badge>
                      <Badge tone={difficultyTone[question.difficulty]}>
                        {difficultyLabels[question.difficulty]}
                      </Badge>
                    </span>
                  </span>
                </label>
              ))
            )}
          </div>

          {state.message && (
            <p
              className={`rounded-2xl px-4 py-3 text-sm font-semibold ring-1 ring-inset ${
                state.status === "success"
                  ? "bg-emerald-500/12 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300"
                  : "bg-rose-500/12 text-rose-700 ring-rose-500/25 dark:text-rose-300"
              }`}
              role="status"
            >
              {state.message}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--glass-border)] pt-4">
            <p className="text-sm text-muted">تم تحديد {selected.length} سؤال</p>
            <div className="flex gap-2">
              <Button onClick={() => setOpen(false)} type="button" variant="secondary">
                إغلاق
              </Button>
              <Button disabled={pending || selected.length === 0} type="submit">
                {pending && <Spinner />}
                {pending ? "جارٍ الإضافة..." : "إضافة الأسئلة"}
              </Button>
            </div>
          </div>
        </form>
      </Modal>
    </>
  );
}

function QuestionRow({
  examId,
  question,
  readOnly,
}: {
  examId: string;
  question: ExamQuestionItem;
  readOnly: boolean;
}) {
  const [score, setScore] = useState(String(question.score));
  const [removeState, removeAction, removing] = useActionState(
    removeExamQuestionAction,
    initialState,
  );
  const [scoreState, scoreAction, savingScore] = useActionState(
    updateQuestionScoreAction,
    initialState,
  );

  const dirty = Number(score) !== question.score;

  return (
    <tr>
      <td className="px-3 py-3 text-center text-xs font-bold text-muted">
        {question.position}
      </td>
      <td className="px-3 py-3">
        <p className="text-sm font-semibold leading-6 text-[var(--app-text)]">{question.text}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted">
          <Badge tone="blue">{questionTypeLabels[question.type]}</Badge>
          <Badge tone={difficultyTone[question.difficulty]}>
            {difficultyLabels[question.difficulty]}
          </Badge>
          {question.unit && <span>الوحدة: {question.unit}</span>}
        </div>
      </td>
      <td className="px-3 py-3">
        {readOnly ? (
          <span className="text-sm font-bold">{question.score}</span>
        ) : (
          <form action={scoreAction} className="flex items-center gap-2">
            <input name="examId" type="hidden" value={examId} />
            <input name="questionId" type="hidden" value={question.questionId} />
            <input name="score" type="hidden" value={score} />
            <Input
              className="h-9 w-20 text-center"
              min={0}
              onChange={(event) => setScore(event.target.value)}
              step="0.5"
              type="number"
              value={score}
            />
            <Button disabled={!dirty || savingScore} size="sm" title="حفظ الدرجة" type="submit" variant="ghost">
              {savingScore ? <Spinner /> : <Save aria-hidden className="size-4" />}
            </Button>
          </form>
        )}
      </td>
      <td className="px-3 py-3 text-left">
        {!readOnly && (
          <form
            action={removeAction}
            onSubmit={(event) => {
              if (!window.confirm("سيتم حذف السؤال من الامتحان. هل تريد المتابعة؟")) {
                event.preventDefault();
              }
            }}
          >
            <input name="examId" type="hidden" value={examId} />
            <input name="questionId" type="hidden" value={question.questionId} />
            <button
              className="rounded-lg p-2 text-rose-600 transition hover:bg-rose-50 disabled:opacity-50 dark:hover:bg-rose-950/60"
              disabled={removing}
              title="حذف السؤال من الامتحان"
              type="submit"
            >
              {removing ? <Spinner /> : <Trash2 aria-hidden className="size-4" />}
            </button>
          </form>
        )}
      </td>
    </tr>
  );
}

export function ExamQuestionsManager({
  examId,
  questions,
  totalScore,
  bank,
  canManage,
  isDraft,
}: {
  examId: string;
  questions: ExamQuestionItem[];
  totalScore: number;
  bank: BankQuestion[];
  canManage: boolean;
  isDraft: boolean;
}) {
  const questionsScore = questions.reduce((sum, question) => sum + question.score, 0);
  const mismatch = Math.abs(questionsScore - totalScore) > 0.001;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone="blue">{questions.length} سؤال</Badge>
          <Badge tone={mismatch ? "warning" : "success"}>
            درجات الأسئلة: {questionsScore} / {totalScore}
          </Badge>
          {mismatch && (
            <span className="text-xs font-semibold text-amber-600">
              مجموع درجات الأسئلة لا يساوي الدرجة الكلية
            </span>
          )}
        </div>

        {canManage && isDraft && (
          <AddQuestionsDialog
            attachedIds={questions.map((question) => question.questionId)}
            bank={bank}
            examId={examId}
          />
        )}
      </div>

      {!isDraft && (
        <p className="rounded-2xl border border-dashed border-[var(--glass-border)] px-4 py-3 text-xs font-semibold text-muted">
          الأسئلة مقفلة لأن الامتحان منشور. أعد الامتحان إلى المسودة لتعديل الأسئلة.
        </p>
      )}

      {questions.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--glass-border)] px-4 py-10 text-center">
          <Library aria-hidden className="mx-auto mb-3 size-8 text-slate-400" />
          <p className="text-sm font-bold text-[var(--app-text)]">لا توجد أسئلة في هذا الامتحان</p>
          <p className="mt-1 text-xs text-muted">أضف أسئلة من بنك الأسئلة قبل نشر الامتحان.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[42rem] border-separate border-spacing-y-2 text-right text-sm">
            <thead>
              <tr className="text-xs font-bold text-muted">
                <th className="w-12 px-3 pb-1">#</th>
                <th className="px-3 pb-1">السؤال</th>
                <th className="w-40 px-3 pb-1">الدرجة</th>
                <th className="w-16 px-3 pb-1" />
              </tr>
            </thead>
            <tbody>
              {questions.map((question) => (
                <QuestionRow
                  examId={examId}
                  key={question.questionId}
                  question={question}
                  readOnly={!canManage || !isDraft}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
