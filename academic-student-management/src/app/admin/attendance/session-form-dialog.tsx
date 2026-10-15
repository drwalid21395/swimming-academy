"use client";

import { CalendarPlus } from "lucide-react";
import { useActionState, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Spinner } from "@/components/ui/loading";
import { Modal } from "@/components/ui/modal";
import type { SessionFormValues, SessionOption } from "@/lib/attendance";
import { formatNumber } from "@/lib/format";

import { createSessionAction, type AttendanceActionState } from "./actions";

const initialState: AttendanceActionState = { status: "idle" };

export type SessionCreator = {
  id: string;
  fullName: string;
  employeeCode: string;
  isActive: boolean;
};

function today() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export function SessionFormDialog({
  subjects,
  creators,
  fixedCreatorId,
}: {
  subjects: SessionOption[];
  creators: SessionCreator[];
  /** When provided (professor portal) the creator is locked server-side to the current professor. */
  fixedCreatorId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [subjectId, setSubjectId] = useState(subjects[0]?.id ?? "");
  const [defaultDate, setDefaultDate] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState(createSessionAction, initialState);

  useEffect(() => {
    if (state.status === "success") setOpen(false);
  }, [state.status]);

  const selected = subjects.find((subject) => subject.id === subjectId);
  const defaultCreator = creators.find(
    (creator) => creator.id === selected?.primaryProfessorId,
  );

  const errorFor = (field: keyof SessionFormValues) => state.fieldErrors?.[field];
  const valueFor = (field: string, fallback: string) => state.values?.[field] ?? fallback;

  return (
    <>
      <Button
        onClick={() => {
          setDefaultDate(today());
          setOpen(true);
        }}
        size="sm"
      >
        <CalendarPlus aria-hidden className="size-4" />
        محاضرة جديدة
      </Button>

      <Modal
        description="أنشئ محاضرة ثم سجّل حضور طلاب المادة فيها."
        onClose={() => setOpen(false)}
        open={open}
        title="تسجيل محاضرة جديدة"
      >
        <form action={formAction} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              error={errorFor("subjectId")}
              hint={selected ? `${formatNumber(selected.studentsCount)} طالب مسجل` : undefined}
              htmlFor="subjectId"
              label="المادة"
              required
            >
              <Select
                defaultValue={valueFor("subjectId", subjectId)}
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

            <Field error={errorFor("date")} htmlFor="date" label="تاريخ المحاضرة" required>
              <Input
                defaultValue={valueFor("date", defaultDate ?? "")}
                dir="ltr"
                id="date"
                name="date"
                required
                type="date"
              />
            </Field>

            {fixedCreatorId ? (
              <input name="createdById" type="hidden" value={fixedCreatorId} />
            ) : (
              <Field
                error={errorFor("createdById")}
                htmlFor="createdById"
                hint="يفترض تلقائياً الأستاذ الأساسي للمادة"
                label="عضو هيئة التدريس"
                required
              >
                <Select
                  defaultValue={valueFor("createdById", defaultCreator?.id ?? "")}
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
            )}

            <Field error={errorFor("title")} htmlFor="title" label="عنوان المحاضرة">
              <Input
                defaultValue={valueFor("title", "")}
                id="title"
                name="title"
                placeholder="مثال: الأسبوع الثالث - الوراثة"
              />
            </Field>
          </div>

          <Field error={errorFor("notes")} htmlFor="notes" label="ملاحظات">
            <Textarea
              defaultValue={valueFor("notes", "")}
              id="notes"
              name="notes"
              placeholder="ما تم تغطيته في المحاضرة..."
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
              {pending ? "جارٍ الإنشاء..." : "إنشاء المحاضرة"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
