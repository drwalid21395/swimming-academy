"use client";

import { ClipboardList, Pencil } from "lucide-react";
import { useActionState, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Spinner } from "@/components/ui/loading";
import { Modal } from "@/components/ui/modal";
import { examStatusLabels } from "@/lib/labels";
import type { ExamEditData, ExamFormValues } from "@/lib/exams";

import { createExamAction, updateExamAction, type ExamActionState } from "./actions";

const initialState: ExamActionState = { status: "idle" };

export type ExamSubjectOption = {
  id: string;
  name: string;
  code: string;
  primaryProfessorId: string | null;
};

export type ExamCreatorOption = { id: string; fullName: string; employeeCode: string };

type ExamDefaultWindow = { startsAt: string; endsAt: string };

function defaultWindow(): ExamDefaultWindow {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const format = (date: Date) => {
    const pad = (part: number) => String(part).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
      date.getHours(),
    )}:${pad(date.getMinutes())}`;
  };
  return { startsAt: format(start), endsAt: format(end) };
}

export function ExamFormDialog({
  mode,
  subjects,
  creators,
  exam,
  initiallyOpen = false,
}: {
  mode: "create" | "edit";
  subjects: ExamSubjectOption[];
  creators: ExamCreatorOption[];
  exam?: ExamEditData;
  initiallyOpen?: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const [subjectId, setSubjectId] = useState(exam?.subjectId ?? subjects[0]?.id ?? "");
  const [defaults, setDefaults] = useState<ExamDefaultWindow | null>(null);
  const action = mode === "create" ? createExamAction : updateExamAction;
  const [state, formAction, pending] = useActionState(action, initialState);

  useEffect(() => {
    if (state.status === "success") setOpen(false);
  }, [state.status]);

  const selected = subjects.find((subject) => subject.id === subjectId);
  const fallbackCreator =
    creators.find((creator) => creator.id === selected?.primaryProfessorId) ?? creators[0];

  const errorFor = (field: keyof ExamFormValues) => state.fieldErrors?.[field];
  const valueFor = (field: string, fallback: string) => state.values?.[field] ?? fallback;

  return (
    <>
      <Button
        onClick={() => {
          setDefaults(defaultWindow());
          setOpen(true);
        }}
        size="sm"
        variant={mode === "create" ? "primary" : "secondary"}
      >
        {mode === "create" ? (
          <>
            <ClipboardList aria-hidden className="size-4" />
            امتحان جديد
          </>
        ) : (
          <>
            <Pencil aria-hidden className="size-4" />
            تعديل
          </>
        )}
      </Button>

      <Modal
        description="يُنشأ الامتحان كمسودة، أضف الأسئلة ثم انشره للطلاب."
        onClose={() => setOpen(false)}
        open={open}
        title={mode === "create" ? "إنشاء امتحان جديد" : `تعديل ${exam?.title ?? "الامتحان"}`}
      >
        <form action={formAction} className="space-y-4" noValidate>
          {mode === "edit" && (
            <>
              <input name="examId" type="hidden" value={exam?.id ?? ""} />
              {exam && (
                <p className="rounded-2xl bg-brand-500/10 px-4 py-2.5 text-xs font-semibold text-brand-700 dark:text-brand-200">
                  الحالة الحالية: {examStatusLabels[exam.status]}
                </p>
              )}
            </>
          )}

          <Field error={errorFor("title")} htmlFor="title" label="عنوان الامتحان" required>
            <Input
              defaultValue={valueFor("title", exam?.title ?? "")}
              id="title"
              name="title"
              placeholder="مثال: امتحان الوحدة الثالثة"
              required
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field error={errorFor("subjectId")} htmlFor="subjectId" label="المادة" required>
              <Select
                defaultValue={valueFor("subjectId", exam?.subjectId ?? subjectId)}
                id="subjectId"
                name="subjectId"
                onChange={(event) => setSubjectId(event.target.value)}
                required
              >
                <option value="">اختر المادة</option>
                {subjects.map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.name} ({subject.code})
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              error={errorFor("createdById")}
              htmlFor="createdById"
              hint="يفترض تلقائياً الأستاذ الأساسي للمادة"
              label="عضو هيئة التدريس"
              required
            >
              <Select
                defaultValue={valueFor("createdById", exam?.createdById ?? fallbackCreator?.id ?? "")}
                id="createdById"
                key={`${subjectId}-${state.status}`}
                name="createdById"
                required
              >
                <option value="">اختر العضو</option>
                {creators.map((creator) => (
                  <option key={creator.id} value={creator.id}>
                    {creator.fullName} ({creator.employeeCode})
                  </option>
                ))}
              </Select>
            </Field>

            <Field error={errorFor("startsAt")} htmlFor="startsAt" label="يبدأ في" required>
              <Input
                defaultValue={valueFor("startsAt", exam?.startsAt ?? defaults?.startsAt ?? "")}
                dir="ltr"
                id="startsAt"
                name="startsAt"
                required
                type="datetime-local"
              />
            </Field>

            <Field error={errorFor("endsAt")} htmlFor="endsAt" label="ينتهي في" required>
              <Input
                defaultValue={valueFor("endsAt", exam?.endsAt ?? defaults?.endsAt ?? "")}
                dir="ltr"
                id="endsAt"
                name="endsAt"
                required
                type="datetime-local"
              />
            </Field>

            <Field
              error={errorFor("durationMin")}
              hint="بالدقائق"
              htmlFor="durationMin"
              label="مدة الحل"
              required
            >
              <Input
                defaultValue={valueFor("durationMin", String(exam?.durationMin ?? 60))}
                dir="ltr"
                id="durationMin"
                max={600}
                min={1}
                name="durationMin"
                required
                type="number"
              />
            </Field>

            <Field
              error={errorFor("totalScore")}
              hint="الدرجة الكلية للامتحان"
              htmlFor="totalScore"
              label="الدرجة الكلية"
              required
            >
              <Input
                defaultValue={valueFor("totalScore", String(exam?.totalScore ?? 20))}
                dir="ltr"
                id="totalScore"
                min={1}
                name="totalScore"
                required
                step="0.5"
                type="number"
              />
            </Field>
          </div>

          <Field error={errorFor("description")} htmlFor="description" label="تعليمات للطلاب">
            <Textarea
              defaultValue={valueFor("description", exam?.description ?? "")}
              id="description"
              name="description"
              placeholder="تعليمات اختيارية تظهر للطلاب مع الامتحان..."
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

          <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--glass-border)] pt-4">
            <Button onClick={() => setOpen(false)} type="button" variant="secondary">
              إلغاء
            </Button>
            <Button disabled={pending} type="submit">
              {pending && <Spinner />}
              {pending ? "جارٍ الحفظ..." : mode === "create" ? "إنشاء الامتحان" : "حفظ التعديلات"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
