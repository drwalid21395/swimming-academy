"use client";

import { Library, Pencil, Plus } from "lucide-react";
import { useActionState, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Spinner } from "@/components/ui/loading";
import { Modal } from "@/components/ui/modal";
import type { QuestionEditData, QuestionFormValues } from "@/lib/exams";
import { difficultyLabels, questionTypeLabels } from "@/lib/labels";

import {
  createQuestionAction,
  updateQuestionAction,
  type QuestionActionState,
} from "./actions";

const initialState: QuestionActionState = { status: "idle" };

const types = ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER", "ESSAY"] as const;
const difficulties = ["EASY", "MEDIUM", "HARD"] as const;

export type QuestionSubjectOption = {
  id: string;
  name: string;
  code: string;
  primaryProfessorId: string | null;
};

export type QuestionCreatorOption = { id: string; fullName: string; employeeCode: string };
export type CategoryOption = { id: string; name: string; subjectId: string };

type OptionDraft = { text: string; isCorrect: boolean };

function needsOptions(type: string) {
  return type === "MULTIPLE_CHOICE" || type === "TRUE_FALSE";
}

export function QuestionFormDialog({
  mode,
  subjects,
  creators,
  categories,
  question,
  fixedCreatorId,
  initiallyOpen = false,
}: {
  mode: "create" | "edit";
  subjects: QuestionSubjectOption[];
  creators: QuestionCreatorOption[];
  categories: CategoryOption[];
  question?: QuestionEditData;
  /** When provided (professor portal) the creator is locked server-side to the current professor. */
  fixedCreatorId?: string;
  /** Opens the dialog on first render so the form is reachable via ?new=1. */
  initiallyOpen?: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const [subjectId, setSubjectId] = useState(question?.subjectId ?? subjects[0]?.id ?? "");
  const [type, setType] = useState<string>(question?.type ?? "MULTIPLE_CHOICE");
  const [options, setOptions] = useState<OptionDraft[]>(() => {
    if (question?.options.length) {
      return question.options.map((option) => ({ text: option.text, isCorrect: option.isCorrect }));
    }
    if (question?.type === "TRUE_FALSE") {
      return [
        { text: "صح", isCorrect: true },
        { text: "خطأ", isCorrect: false },
      ];
    }
    return [
      { text: "", isCorrect: true },
      { text: "", isCorrect: false },
      { text: "", isCorrect: false },
      { text: "", isCorrect: false },
    ];
  });

  const action = mode === "create" ? createQuestionAction : updateQuestionAction;
  const [state, formAction, pending] = useActionState(action, initialState);

  useEffect(() => {
    if (state.status === "success") setOpen(false);
  }, [state.status]);

  const selected = subjects.find((subject) => subject.id === subjectId);
  const fallbackCreator =
    creators.find((creator) => creator.id === selected?.primaryProfessorId) ?? creators[0];
  const subjectCategories = categories.filter((category) => category.subjectId === subjectId);

  const errorFor = (field: keyof QuestionFormValues) => state.fieldErrors?.[field];
  const valueFor = (field: string, fallback: string) => state.values?.[field] ?? fallback;

  const setOption = (index: number, updates: Partial<OptionDraft>) => {
    setOptions((current) =>
      current.map((option, position) => (position === index ? { ...option, ...updates } : option)),
    );
  };

  /** Exactly one option may be correct, so selecting an option clears the flag on all others. */
  const markCorrect = (index: number) => {
    setOptions((current) =>
      current.map((option, position) => ({ ...option, isCorrect: position === index })),
    );
  };

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        size="sm"
        variant={mode === "create" ? "primary" : "secondary"}
      >
        {mode === "create" ? (
          <>
            <Plus aria-hidden className="size-4" />
            سؤال جديد
          </>
        ) : (
          <>
            <Pencil aria-hidden className="size-4" />
            تعديل
          </>
        )}
      </Button>

      <Modal
        description="أسئلة الاختيار من متعدد تحتاج خيارات مع تحديد الإجابة الصحيحة."
        onClose={() => setOpen(false)}
        open={open}
        size="lg"
        title={mode === "create" ? "إضافة سؤال إلى البنك" : "تعديل السؤال"}
      >
        <form action={formAction} className="space-y-4" noValidate>
          {mode === "edit" && <input name="questionId" type="hidden" value={question?.id ?? ""} />}

          <Field error={errorFor("text")} htmlFor="text" label="نص السؤال" required>
            <Textarea
              defaultValue={valueFor("text", question?.text ?? "")}
              id="text"
              name="text"
              placeholder="اكتب نص السؤال هنا..."
              required
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <Field error={errorFor("subjectId")} htmlFor="subjectId" label="المادة" required>
              <Select
                defaultValue={valueFor("subjectId", question?.subjectId ?? subjectId)}
                id="subjectId"
                name="subjectId"
                onChange={(event) => setSubjectId(event.target.value)}
                required
              >
                <option value="">اختر المادة</option>
                {subjects.map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field error={errorFor("type")} htmlFor="type" label="نوع السؤال" required>
              <Select
                defaultValue={valueFor("type", question?.type ?? "MULTIPLE_CHOICE")}
                id="type"
                name="type"
                onChange={(event) => {
                  const nextType = event.target.value;
                  setType(nextType);

                  if (nextType === "TRUE_FALSE") {
                    setOptions([
                      { text: "صح", isCorrect: true },
                      { text: "خطأ", isCorrect: false },
                    ]);
                  } else if (nextType === "MULTIPLE_CHOICE" && options.length < 2) {
                    setOptions([
                      { text: "", isCorrect: true },
                      { text: "", isCorrect: false },
                    ]);
                  }
                }}
                required
              >
                {types.map((item) => (
                  <option key={item} value={item}>
                    {questionTypeLabels[item]}
                  </option>
                ))}
              </Select>
            </Field>

            <Field error={errorFor("difficulty")} htmlFor="difficulty" label="الصعوبة" required>
              <Select
                defaultValue={valueFor("difficulty", question?.difficulty ?? "MEDIUM")}
                id="difficulty"
                name="difficulty"
                required
              >
                {difficulties.map((item) => (
                  <option key={item} value={item}>
                    {difficultyLabels[item]}
                  </option>
                ))}
              </Select>
            </Field>

            {fixedCreatorId ? (
              <input name="createdById" type="hidden" value={fixedCreatorId} />
            ) : (
              <Field
                error={errorFor("createdById")}
                htmlFor="createdById"
                hint="يفترض تلقائياً الأستاذ الأساسي"
                label="عضو هيئة التدريس"
                required
              >
                <Select
                  defaultValue={valueFor(
                    "createdById",
                    question?.createdById ?? fallbackCreator?.id ?? "",
                  )}
                  id="createdById"
                  key={`${subjectId}-${state.status}`}
                  name="createdById"
                  required
                >
                  <option value="">اختر العضو</option>
                  {creators.map((creator) => (
                    <option key={creator.id} value={creator.id}>
                      {creator.fullName}
                    </option>
                  ))}
                </Select>
              </Field>
            )}

            <Field error={errorFor("categoryId")} htmlFor="categoryId" label="التصنيف">
              <Select
                defaultValue={valueFor("categoryId", question?.categoryId ?? "")}
                id="categoryId"
                name="categoryId"
              >
                <option value="">بدون تصنيف</option>
                {subjectCategories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field error={errorFor("unit")} htmlFor="unit" label="الوحدة">
              <Input
                defaultValue={valueFor("unit", question?.unit ?? "")}
                id="unit"
                name="unit"
                placeholder="مثال: الوحدة الثانية"
              />
            </Field>
          </div>

          {needsOptions(type) && (
            <div className="space-y-2">
              <p className="text-sm font-bold text-[var(--app-text)]">
                الخيارات <span className="text-rose-500">*</span>
              </p>
              <p className="text-xs text-muted">
                {type === "TRUE_FALSE"
                  ? "أسئلة صح وخطأ تستخدم خيارين ثابتين."
                  : "اكتب الخيارات ثم اضغط «الإجابة الصحيحة» بجوار الخيار الصحيح (واحد فقط)."}
              </p>
              {options.map((option, index) => (
                <div className="flex flex-wrap items-center gap-2" key={index}>
                  <Input
                    className="h-10 min-w-48 flex-1"
                    name="optionText"
                    onChange={(event) => setOption(index, { text: event.target.value })}
                    placeholder={`الخيار ${index + 1}`}
                    readOnly={type === "TRUE_FALSE"}
                    value={option.text}
                  />
                  <label
                    className="flex shrink-0 cursor-pointer items-center gap-2 rounded-xl border border-[var(--glass-border)] bg-[var(--field-bg)] px-3 py-2 text-xs font-bold text-muted transition hover:border-brand-500/50 hover:text-brand-600 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-500/12 has-[:checked]:text-brand-600"
                    title={`تحديد الخيار ${index + 1} كالإجابة الصحيحة`}
                  >
                    <input
                      checked={option.isCorrect}
                      className="size-4 accent-brand-600"
                      name="correctOptionIndex"
                      onChange={() => markCorrect(index)}
                      type="radio"
                      value={String(index)}
                    />
                    <span className="whitespace-nowrap">الإجابة الصحيحة</span>
                  </label>
                </div>
              ))}
              {type === "MULTIPLE_CHOICE" && (
                <Button
                  onClick={() => setOptions((current) => [...current, { text: "", isCorrect: false }])}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <Plus aria-hidden className="size-4" />
                  إضافة خيار
                </Button>
              )}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              error={errorFor("correctAnswer")}
              hint="إجابة نموذجية للمقالي/القصير أو مفتاح التصحيح"
              htmlFor="correctAnswer"
              label="الإجابة النموذجية"
            >
              <Input
                defaultValue={valueFor("correctAnswer", question?.correctAnswer ?? "")}
                id="correctAnswer"
                name="correctAnswer"
              />
            </Field>

            <Field error={errorFor("chapter")} htmlFor="chapter" label="الفصل">
              <Input
                defaultValue={valueFor("chapter", question?.chapter ?? "")}
                id="chapter"
                name="chapter"
              />
            </Field>
          </div>

          <Field error={errorFor("explanation")} htmlFor="explanation" label="شرح الإجابة">
            <Textarea
              defaultValue={valueFor("explanation", question?.explanation ?? "")}
              id="explanation"
              name="explanation"
              placeholder="شرح يُعرض للطالب بعد التصحيح..."
            />
          </Field>

          {state.status === "error" && state.message && (
            <p
              className="rounded-2xl bg-rose-500/12 px-4 py-3 text-sm font-semibold text-rose-700 ring-1 ring-inset ring-rose-500/25 dark:text-rose-300"
              role="alert"
            >
              {state.message}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--glass-border)] pt-4">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-muted">
              <Library aria-hidden className="size-4" />
              السؤال سيُحفظ في بنك الأسئلة الخاص بالمادة
            </span>
            <div className="flex gap-2">
              <Button onClick={() => setOpen(false)} type="button" variant="secondary">
                إلغاء
              </Button>
              <Button disabled={pending} type="submit">
                {pending && <Spinner />}
                {pending ? "جارٍ الحفظ..." : mode === "create" ? "إضافة السؤال" : "حفظ التعديلات"}
              </Button>
            </div>
          </div>
        </form>
      </Modal>
    </>
  );
}
