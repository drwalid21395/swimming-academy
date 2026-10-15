"use client";

import { CheckCircle2, Eye, Pencil } from "lucide-react";
import { useState } from "react";

import { QuestionStudentView } from "@/components/questions/question-student-view";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import type { QuestionListItem } from "@/lib/exams";
import { formatNumber } from "@/lib/format";
import { difficultyLabels, questionTypeLabels } from "@/lib/labels";

const difficultyTones = {
  EASY: "success",
  MEDIUM: "warning",
  HARD: "danger",
} as const;

type PreviewTab = "attempt" | "result";

/** Shows a bank question exactly the way students see it, without leaving the questions tab. */
export function QuestionPreviewDialog({
  question,
  editHref,
}: {
  question: QuestionListItem;
  /** Where "تعديل السؤال" points; defaults to the admin question bank. */
  editHref?: string;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<PreviewTab>("attempt");

  const meta = [
    { label: "المادة", value: `${question.subjectName} (${question.subjectCode})` },
    { label: "النوع", value: questionTypeLabels[question.type] },
    { label: "الصعوبة", value: difficultyLabels[question.difficulty] },
    { label: "الوحدة", value: question.unit ?? "—" },
    { label: "الفصل", value: question.chapter ?? "—" },
    { label: "التصنيف", value: question.categoryName ?? "—" },
    { label: "عضو هيئة التدريس", value: question.professorName },
    {
      label: "الخيارات",
      value:
        question.optionsCount > 0 ? `${formatNumber(question.optionsCount)} خيارات` : "بدون خيارات",
    },
    {
      label: "مستخدم في",
      value:
        question.usedInExams > 0 ? `${formatNumber(question.usedInExams)} امتحان` : "غير مستخدم",
    },
  ];

  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm" type="button" variant="ghost">
        <Eye aria-hidden className="size-4" />
        معاينة
      </Button>

      <Modal
        description="هذه هي الصيغة التي يظهر بها السؤال للطالب داخل الامتحان."
        onClose={() => setOpen(false)}
        open={open}
        size="lg"
        title="معاينة السؤال"
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => setTab("attempt")}
                size="sm"
                type="button"
                variant={tab === "attempt" ? "subtle" : "ghost"}
              >
                أثناء الامتحان
              </Button>
              <Button
                onClick={() => setTab("result")}
                size="sm"
                type="button"
                variant={tab === "result" ? "subtle" : "ghost"}
              >
                بعد التصحيح
              </Button>
            </div>

            <ButtonLink href={editHref ?? `/admin/questions?edit=${question.id}`} size="sm" variant="outline">
              <Pencil aria-hidden className="size-4" />
              تعديل السؤال
            </ButtonLink>
          </div>

          {tab === "attempt" ? (
            <>
              <QuestionStudentView
                options={question.options}
                position={1}
                score={1}
                text={question.text}
                unit={question.unit}
              />
              <p className="text-xs leading-6 text-muted">
                الدرجة الظاهرة افتراضية، ويُحدَّد وزن السؤال فعليًا من صفحة الامتحان، ولا تُعرض
                الإجابة الصحيحة للطالب أثناء الامتحان.
              </p>
            </>
          ) : (
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-bold leading-7 text-[var(--app-text)]">
                  <span className="me-2 text-brand-600 dark:text-brand-300">1.</span>
                  {question.text}
                </h3>
                <Badge tone="neutral">1 درجة</Badge>
              </div>

              {question.options.length > 0 && (
                <ul className="space-y-1.5">
                  {question.options.map((option) => (
                    <li
                      className={`flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm ring-1 ring-inset ${
                        option.isCorrect
                          ? "bg-emerald-500/10 font-semibold text-emerald-700 ring-emerald-500/25 dark:text-emerald-300"
                          : "text-muted ring-[var(--glass-border)]"
                      }`}
                      key={option.id}
                    >
                      <span>{option.text}</span>
                      {option.isCorrect && (
                        <span className="flex items-center gap-1 text-xs">
                          <CheckCircle2 aria-hidden className="size-3.5" />
                          الإجابة الصحيحة
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {question.correctAnswer && (
                <div className="rounded-2xl bg-emerald-500/8 p-3 text-sm ring-1 ring-inset ring-emerald-500/20">
                  <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                    الإجابة النموذجية
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-[var(--app-text)]">
                    {question.correctAnswer}
                  </p>
                </div>
              )}

              {question.explanation && (
                <div className="rounded-2xl bg-[var(--glass-bg)] p-3 text-sm leading-7 ring-1 ring-inset ring-[var(--glass-border)]">
                  <p className="text-xs font-semibold text-muted">شرح الإجابة</p>
                  <p className="mt-1 whitespace-pre-wrap text-[var(--app-text)]">
                    {question.explanation}
                  </p>
                </div>
              )}

              <p className="text-xs leading-6 text-muted">
                يظهر هذا القسم للطالب بعد تصحيح الامتحان فقط، وتظهر الإجابة الصحيحة إذا كان
                الامتحان يسمح بإظهارها.
              </p>
            </div>
          )}

          <div className="rounded-2xl bg-[var(--glass-bg)] p-4 ring-1 ring-inset ring-[var(--glass-border)]">
            <p className="mb-3 text-sm font-bold text-[var(--app-text)]">بيانات السؤال</p>
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {meta.map((item) => (
                <div key={item.label}>
                  <dt className="text-xs text-muted">{item.label}</dt>
                  <dd className="mt-1 text-sm font-semibold text-[var(--app-text)]">{item.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </Modal>
    </>
  );
}
