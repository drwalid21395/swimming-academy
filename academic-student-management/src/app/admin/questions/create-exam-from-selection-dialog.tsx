"use client";

import { ClipboardList, X } from "lucide-react";
import { useActionState, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Spinner } from "@/components/ui/loading";
import { Modal } from "@/components/ui/modal";
import type { ExamFormValues, QuestionListItem } from "@/lib/exams";
import { distributeExamScores, summarizeScores } from "@/lib/exam-scores";
import { questionTypeLabels } from "@/lib/labels";

import { createExamWithQuestionsAction, type ExamActionState } from "../exams/actions";

const initialState: ExamActionState = { status: "idle" };

export type ExamSubjectChoice = {
  id: string;
  name: string;
  code: string;
  primaryProfessorId: string | null;
};

export type ExamCreatorChoice = { id: string; fullName: string; employeeCode: string };

function defaultWindow() {
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

/** Builds a draft exam from the questions ticked in the question bank, in a single step. */
export function CreateExamFromSelectionDialog({
  open,
  onClose,
  questions,
  subjects,
  creators,
  examHrefBase = "/admin/exams",
}: {
  open: boolean;
  onClose: () => void;
  questions: QuestionListItem[];
  subjects: ExamSubjectChoice[];
  creators: ExamCreatorChoice[];
  examHrefBase?: string;
}) {
  const [state, formAction, pending] = useActionState(createExamWithQuestionsAction, initialState);
  const [window_, setWindow] = useState(defaultWindow);
  const [totalScore, setTotalScore] = useState(String(Math.max(1, questions.length)));
  const [durationMin, setDurationMin] = useState(String(Math.max(5, questions.length * 2)));

  const selectionSubjects = Array.from(new Set(questions.map((question) => question.subjectId)));
  const singleSubject = selectionSubjects.length === 1 ? selectionSubjects[0] : null;
  const subjectOptions = singleSubject
    ? subjects.filter((subject) => subject.id === singleSubject)
    : subjects;
  const [subjectId, setSubjectId] = useState(singleSubject ?? subjects[0]?.id ?? "");
  const activeSubjectId = subjectOptions.some((subject) => subject.id === subjectId)
    ? subjectId
    : (subjectOptions[0]?.id ?? "");

  const selected = subjects.find((subject) => subject.id === activeSubjectId);
  const fallbackCreator =
    creators.find((creator) => creator.id === selected?.primaryProfessorId) ?? creators[0];

  useEffect(() => {
    if (!open) return;
    setWindow(defaultWindow());
    setTotalScore(String(Math.max(1, questions.length)));
    setDurationMin(String(Math.max(5, questions.length * 2)));
    setSubjectId(singleSubject ?? subjects[0]?.id ?? "");
  }, [open, questions.length, singleSubject, subjects]);

  const errorFor = (field: string) => state.fieldErrors?.[field as keyof ExamFormValues];
  const valueFor = (field: string, fallback: string) => state.values?.[field] ?? fallback;

  const scores = distributeExamScores(Number(totalScore) || 0, questions.length);
  const mixedSubjects = selectionSubjects.length > 1;

  if (!open) return null;

  return (
    <Modal
      description={`سيتم إنشاء امتحان مسودة من ${questions.length} سؤال محدد، ثم يمكنك مراجعة الأوزان ونشره.`}
      onClose={onClose}
      open={open}
      size="lg"
      title="إنشاء امتحان من الأسئلة المحددة"
    >
      <form action={formAction} className="space-y-4" noValidate>
        {questions.map((question) => (
          <input key={question.id} name="questionIds" type="hidden" value={question.id} />
        ))}

        {state.status === "success" && state.examId ? (
          <div className="space-y-4">
            <p
              className="rounded-2xl bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-500/25 dark:text-emerald-300"
              role="alert"
            >
              {state.message}
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <Button onClick={onClose} type="button" variant="secondary">
                إغلاق
              </Button>
              <ButtonLink href={`${examHrefBase}/${state.examId}`}>
                <ClipboardList aria-hidden className="size-4" />
                فتح الامتحان
              </ButtonLink>
            </div>
          </div>
        ) : (
          <>
            {mixedSubjects && (
              <p
                className="rounded-2xl bg-amber-500/10 px-4 py-3 text-sm leading-7 text-amber-900 ring-1 ring-inset ring-amber-500/25 dark:text-amber-200"
                role="alert"
              >
                الأسئلة المحددة تنتمي إلى {selectionSubjects.length} مواد مختلفة. امتحان واحد
                يجب أن يخص مادة واحدة فقط، فراجع التحديد.
              </p>
            )}

            <Field error={errorFor("title")} htmlFor="examTitle" label="عنوان الامتحان" required>
              <Input
                defaultValue={valueFor("title", `امتحان ${new Date().toLocaleDateString("ar-EG")}`)}
                id="examTitle"
                name="title"
                required
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field error={errorFor("subjectId")} htmlFor="examSubjectId" label="المادة" required>
                <Select
                  defaultValue={valueFor("subjectId", activeSubjectId)}
                  id="examSubjectId"
                  name="subjectId"
                  onChange={(event) => setSubjectId(event.target.value)}
                  required
                >
                  {subjectOptions.map((subject) => (
                    <option key={subject.id} value={subject.id}>
                      {subject.name} ({subject.code})
                    </option>
                  ))}
                </Select>
              </Field>

              <Field
                error={errorFor("createdById")}
                hint="يفترض تلقائياً الأستاذ الأساسي للمادة"
                htmlFor="examCreatorId"
                label="عضو هيئة التدريس"
                required
              >
                <Select
                  defaultValue={valueFor("createdById", fallbackCreator?.id ?? "")}
                  id="examCreatorId"
                  key={`${activeSubjectId}-${state.status}`}
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

              <Field error={errorFor("startsAt")} htmlFor="examStartsAt" label="موعد البدء" required>
                <Input
                  defaultValue={valueFor("startsAt", window_.startsAt)}
                  id="examStartsAt"
                  name="startsAt"
                  required
                  type="datetime-local"
                />
              </Field>

              <Field error={errorFor("endsAt")} htmlFor="examEndsAt" label="موعد الانتهاء" required>
                <Input
                  defaultValue={valueFor("endsAt", window_.endsAt)}
                  id="examEndsAt"
                  name="endsAt"
                  required
                  type="datetime-local"
                />
              </Field>

              <Field error={errorFor("durationMin")} htmlFor="examDuration" label="المدة (دقيقة)" required>
                <Input
                  id="examDuration"
                  max={600}
                  min={1}
                  name="durationMin"
                  onChange={(event) => setDurationMin(event.target.value)}
                  required
                  type="number"
                  value={durationMin}
                />
              </Field>

              <Field
                error={errorFor("totalScore")}
                hint={`سيتم توزيعها تلقائياً: ${summarizeScores(scores) || "—"}`}
                htmlFor="examTotalScore"
                label="الدرجة الكلية"
                required
              >
                <Input
                  id="examTotalScore"
                  max={1000}
                  min={1}
                  name="totalScore"
                  onChange={(event) => setTotalScore(event.target.value)}
                  required
                  type="number"
                  value={totalScore}
                />
              </Field>
            </div>

            <Field
              error={errorFor("description")}
              htmlFor="examDescription"
              label="وصف الامتحان"
            >
              <Textarea
                defaultValue={valueFor("description", "")}
                id="examDescription"
                name="description"
              />
            </Field>

            <div className="rounded-2xl bg-[var(--glass-bg)] p-4 ring-1 ring-inset ring-[var(--glass-border)]">
              <p className="mb-2 text-sm font-bold text-[var(--app-text)]">
                الأسئلة المحددة ({questions.length})
              </p>
              <ul className="max-h-40 space-y-1.5 overflow-y-auto text-sm text-muted">
                {questions.map((question, index) => (
                  <li className="flex items-start justify-between gap-2" key={question.id}>
                    <span className="min-w-0 truncate">
                      {index + 1}. {question.text}
                    </span>
                    <Badge tone="blue">{questionTypeLabels[question.type]}</Badge>
                  </li>
                ))}
              </ul>
            </div>

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
                <ClipboardList aria-hidden className="size-4" />
                سيُنشأ الامتحان بحالة مسودة حتى تراجعه وتنشره
              </span>
              <div className="flex gap-2">
                <Button onClick={onClose} type="button" variant="secondary">
                  <X aria-hidden className="size-4" />
                  إلغاء
                </Button>
                <Button disabled={pending || mixedSubjects || questions.length === 0} type="submit">
                  {pending && <Spinner />}
                  {pending ? "جارٍ الإنشاء..." : "إنشاء الامتحان"}
                </Button>
              </div>
            </div>
          </>
        )}
      </form>
    </Modal>
  );
}
