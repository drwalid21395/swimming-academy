"use client";

import { Megaphone, Pencil } from "lucide-react";
import { useActionState, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Spinner } from "@/components/ui/loading";
import { Modal } from "@/components/ui/modal";
import type {
  AnnouncementEditData,
  AnnouncementFormValues,
  AnnouncementSubjectOption,
} from "@/lib/announcements";

import {
  createAnnouncementAction,
  updateAnnouncementAction,
  type AnnouncementActionState,
} from "./actions";

const initialState: AnnouncementActionState = { status: "idle" };

type DefaultPublish = { publishAt: string };

function defaultPublishAt(): string {
  const now = new Date();
  now.setSeconds(0, 0);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(
    now.getHours(),
  )}:${pad(now.getMinutes())}`;
}

export function AnnouncementFormDialog({
  mode,
  subjects,
  announcement,
}: {
  mode: "create" | "edit";
  subjects: AnnouncementSubjectOption[];
  announcement?: AnnouncementEditData;
}) {
  const [open, setOpen] = useState(false);
  const [subjectId, setSubjectId] = useState(announcement?.subjectId ?? subjects[0]?.id ?? "");
  const [defaults, setDefaults] = useState<DefaultPublish | null>(null);
  const [state, formAction, pending] = useActionState(
    mode === "create" ? createAnnouncementAction : updateAnnouncementAction,
    initialState,
  );

  useEffect(() => {
    if (state.status === "success") setOpen(false);
  }, [state.status]);

  const errorFor = (field: keyof AnnouncementFormValues) => state.fieldErrors?.[field];
  const valueFor = (field: string, fallback: string) => {
    const value = state.values?.[field];
    return value === undefined ? fallback : String(value);
  };

  return (
    <>
      <Button
        onClick={() => {
          setDefaults({ publishAt: defaultPublishAt() });
          setOpen(true);
        }}
        size="sm"
        variant={mode === "create" ? "primary" : "secondary"}
      >
        {mode === "create" ? (
          <>
            <Megaphone aria-hidden className="size-4" />
            إعلان جديد
          </>
        ) : (
          <>
            <Pencil aria-hidden className="size-4" />
            تعديل
          </>
        )}
      </Button>

      <Modal
        description="يصل الإعلان إلى طلاب المادة في صفحة الأخبار فور نشره."
        onClose={() => setOpen(false)}
        open={open}
        title={mode === "create" ? "نشر إعلان جديد" : `تعديل: ${announcement?.title ?? "الإعلان"}`}
      >
        <form action={formAction} className="space-y-4" noValidate>
          {mode === "edit" && (
            <input name="announcementId" type="hidden" value={announcement?.id ?? ""} />
          )}

          <Field error={errorFor("subjectId")} htmlFor="subjectId" label="المادة" required>
            <Select
              defaultValue={valueFor("subjectId", subjectId)}
              id="subjectId"
              name="subjectId"
              onChange={(event) => setSubjectId(event.target.value)}
            >
              {subjects.map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.name} ({subject.code})
                </option>
              ))}
            </Select>
          </Field>

          <Field error={errorFor("title")} htmlFor="title" label="عنوان الإعلان" required>
            <Input
              defaultValue={valueFor("title", announcement?.title ?? "")}
              id="title"
              name="title"
              placeholder="مثال: موعد الامتحان النهائي"
              required
            />
          </Field>

          <Field error={errorFor("content")} htmlFor="content" label="المحتوى" required>
            <Textarea
              defaultValue={valueFor("content", announcement?.content ?? "")}
              id="content"
              name="content"
              placeholder="اكتب تفاصيل الإعلان هنا..."
              required
              rows={6}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              error={errorFor("publishAt")}
              htmlFor="publishAt"
              label="وقت النشر (اتركه فارغاً للنشر فوراً)"
            >
              <Input
                defaultValue={valueFor("publishAt", defaults?.publishAt ?? "")}
                id="publishAt"
                name="publishAt"
                type="datetime-local"
              />
            </Field>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-bold text-[var(--app-text)]" htmlFor="isPinned">
                تثبيت في الأعلى
              </label>
              <label
                className="flex cursor-pointer items-center gap-3 rounded-2xl border border-[var(--glass-border)] bg-[var(--field-bg)] px-4 py-2.5 text-sm transition hover:bg-[var(--glass-bg-strong)]"
                htmlFor="isPinned"
              >
                <input
                  className="size-4 accent-[var(--color-brand-500)]"
                  defaultChecked={String(state.values?.isPinned ?? announcement?.isPinned ?? false) === "true"}
                  id="isPinned"
                  name="isPinned"
                  type="checkbox"
                  value="true"
                />
                إظهار الإعلان أعلى قائمة الأخبار
              </label>
            </div>
          </div>

          {state.status === "error" && state.message && (
            <p className="rounded-2xl bg-rose-500/12 px-4 py-3 text-sm font-semibold text-rose-700 ring-1 ring-inset ring-rose-500/25 dark:text-rose-300" role="alert">
              {state.message}
            </p>
          )}

          <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--glass-border)] pt-4">
            <Button onClick={() => setOpen(false)} size="sm" type="button" variant="ghost">
              إلغاء
            </Button>
            <Button disabled={pending} type="submit">
              {pending ? <Spinner /> : <Megaphone aria-hidden className="size-4" />}
              {pending ? "جارٍ النشر..." : mode === "create" ? "نشر الإعلان" : "حفظ التعديلات"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
