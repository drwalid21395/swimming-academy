"use client";

import { CalendarPlus, Pencil } from "lucide-react";
import { useActionState, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Spinner } from "@/components/ui/loading";
import { Modal } from "@/components/ui/modal";
import type { TermEditData, TermFormValues } from "@/lib/settings";

import { createTermAction, updateTermAction, type SettingsActionState } from "./actions";

const initialState: SettingsActionState = { status: "idle" };

export function TermFormDialog({
  mode,
  term,
}: {
  mode: "create" | "edit";
  term?: TermEditData;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    mode === "create" ? createTermAction : updateTermAction,
    initialState,
  );

  useEffect(() => {
    if (state.status === "success") setOpen(false);
  }, [state.status]);

  const errorFor = (field: keyof TermFormValues) => state.fieldErrors?.[field];
  const valueFor = (field: string, fallback: string) => {
    const value = state.values?.[field];
    return value === undefined ? fallback : String(value);
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
            <CalendarPlus aria-hidden className="size-4" />
            فصل جديد
          </>
        ) : (
          <>
            <Pencil aria-hidden className="size-4" />
            تعديل
          </>
        )}
      </Button>

      <Modal
        description="الفصل الدراسي الحالي هو النشط في النظام، ويمكن تعديله في أي وقت."
        onClose={() => setOpen(false)}
        open={open}
        title={mode === "create" ? "إضافة فصل دراسي" : `تعديل: ${term?.name ?? "الفصل الدراسي"}`}
      >
        <form action={formAction} className="space-y-4" noValidate>
          {mode === "edit" && <input name="termId" type="hidden" value={term?.id ?? ""} />}

          <Field error={errorFor("name")} htmlFor="name" label="اسم الفصل" required>
            <Input
              defaultValue={valueFor("name", term?.name ?? "")}
              id="name"
              name="name"
              placeholder="مثال: الفصل الأول 2026/2027"
              required
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field error={errorFor("startDate")} htmlFor="startDate" label="تاريخ البداية" required>
              <Input
                defaultValue={valueFor("startDate", term?.startDate ?? "")}
                id="startDate"
                name="startDate"
                required
                type="date"
              />
            </Field>

            <Field error={errorFor("endDate")} htmlFor="endDate" label="تاريخ النهاية" required>
              <Input
                defaultValue={valueFor("endDate", term?.endDate ?? "")}
                id="endDate"
                name="endDate"
                required
                type="date"
              />
            </Field>
          </div>

          {state.status === "error" && state.message && (
            <p
              className="rounded-2xl bg-rose-500/12 px-4 py-3 text-sm font-semibold text-rose-700 ring-1 ring-inset ring-rose-500/25 dark:text-rose-300"
              role="alert"
            >
              {state.message}
            </p>
          )}

          <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--glass-border)] pt-4">
            <Button onClick={() => setOpen(false)} size="sm" type="button" variant="ghost">
              إلغاء
            </Button>
            <Button disabled={pending} type="submit">
              {pending ? <Spinner /> : <CalendarPlus aria-hidden className="size-4" />}
              {pending ? "جارٍ الحفظ..." : "حفظ الفصل الدراسي"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
