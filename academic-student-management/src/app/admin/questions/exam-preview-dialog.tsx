"use client";

import { Eye, RotateCcw, Timer } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { QuestionStudentView } from "@/components/questions/question-student-view";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/states";
import type { QuestionListItem } from "@/lib/exams";

/**
 * "نموذج التدريب": renders a full exam exactly like the student attempt screen
 * (header, live countdown, question cards) without touching the database.
 */
export function ExamPreviewDialog({
  questions,
  open,
  onClose,
}: {
  questions: QuestionListItem[];
  open: boolean;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("نموذج تدريب");
  const [durationMin, setDurationMin] = useState(30);
  const [remaining, setRemaining] = useState(durationMin * 60);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const total = questions.length;
  const answered = useMemo(
    () => questions.filter((question) => answers[question.id]?.trim()).length,
    [answers, questions],
  );

  useEffect(() => {
    if (!open) return;
    setAnswers({});
    setRemaining(Math.max(1, durationMin) * 60);
  }, [open, durationMin]);

  useEffect(() => {
    if (!open || remaining <= 0) return;
    const timer = window.setInterval(() => {
      setRemaining((value) => Math.max(0, value - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [open, remaining]);

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const urgent = remaining <= 300;

  return (
    <Modal
      description="معاينة تجريبية كاملة لشكل الامتحان كما يراه الطالب — بدون حفظ أي إجابات."
      onClose={onClose}
      open={open}
      size="lg"
      title="نموذج التدريب"
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field htmlFor="previewTitle" label="عنوان النموذج">
            <Input
              id="previewTitle"
              maxLength={150}
              onChange={(event) => setTitle(event.target.value)}
              value={title}
            />
          </Field>
          <Field hint="بالدقائق" htmlFor="previewDuration" label="مدة الامتحان">
            <Input
              id="previewDuration"
              max={600}
              min={1}
              onChange={(event) => setDurationMin(Number(event.target.value) || 1)}
              type="number"
              value={durationMin}
            />
          </Field>
        </div>

        <div className="-mx-4 border-b border-[var(--glass-border)] bg-[var(--glass-bg-strong)] px-4 py-3 backdrop-blur-xl sm:-mx-6 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs text-muted">{title}</p>
              <p className="text-sm font-bold text-[var(--app-text)]">
                أجبت على {answered} من {total} سؤال
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
                onClick={() => {
                  setAnswers({});
                  setRemaining(Math.max(1, durationMin) * 60);
                }}
                size="sm"
                type="button"
                variant="secondary"
              >
                <RotateCcw aria-hidden className="size-4" />
                إعادة
              </Button>
            </div>
          </div>

          <p className="mt-2 text-xs text-muted" role="status">
            معامل التدريب: {total} درجة افتراضية (درجة لكل سؤال). يمكنك تجربة الإجابة، ولن تُحفظ
            في سجلات الطلاب.
          </p>
        </div>

        {total === 0 ? (
          <EmptyState
            description="حدد أسئلة من بنك الأسئلة أولاً لتظهر في النموذج."
            title="لا توجد أسئلة للمعاينة"
          />
        ) : (
          questions.map((question, index) => (
            <QuestionStudentView
              fieldName={`preview.${question.id}`}
              key={question.id}
              onAnswerChange={(value) =>
                setAnswers((current) => ({ ...current, [question.id]: value }))
              }
              options={question.options}
              position={index + 1}
              score={1}
              text={question.text}
              unit={question.unit}
              value={answers[question.id] ?? ""}
            />
          ))
        )}
      </div>
    </Modal>
  );
}

/** Self-contained trigger for pages that preview the whole filtered bank. */
export function ExamPreviewButton({
  questions,
  label = "معاينة كنموذج تدريب",
  size = "sm",
  variant = "secondary",
}: {
  questions: QuestionListItem[];
  label?: string;
  size?: "sm" | "md";
  variant?: "primary" | "secondary" | "ghost" | "outline" | "subtle";
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        disabled={questions.length === 0}
        onClick={() => setOpen(true)}
        size={size}
        type="button"
        variant={variant}
      >
        <Eye aria-hidden className="size-4" />
        {label}
      </Button>
      <ExamPreviewDialog onClose={() => setOpen(false)} open={open} questions={questions} />
    </>
  );
}
