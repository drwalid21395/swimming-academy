"use client";

import { Layers, Pencil, Plus } from "lucide-react";
import { useActionState, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Spinner } from "@/components/ui/loading";
import { Modal } from "@/components/ui/modal";
import type { SpecializationEditData, SpecializationInput } from "@/lib/specializations";

import {
  createSpecializationAction,
  updateSpecializationAction,
  type SpecializationActionState,
} from "./actions";
import type { DepartmentOption } from "../students/student-filters";

const initialState: SpecializationActionState = { status: "idle" };

export function SpecializationFormDialog({
  mode,
  departments,
  specialization,
  open: controlledOpen,
  onOpenChange,
}: {
  mode: "create" | "edit";
  departments: DepartmentOption[];
  specialization?: SpecializationEditData;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;

  const setOpen = (next: boolean) => {
    if (!isControlled) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };

  const action = mode === "create" ? createSpecializationAction : updateSpecializationAction;
  const [state, formAction, pending] = useActionState(action, initialState);

  useEffect(() => {
    if (state.status === "success") setOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status]);

  const errorFor = (field: keyof SpecializationInput) => state.fieldErrors?.[field];
  const valueFor = (field: string, fallback: string) => state.values?.[field] ?? fallback;

  return (
    <>
      {isControlled ? (
        <Button onClick={() => setOpen(true)} size="sm" variant="secondary">
          <Pencil aria-hidden className="size-4" />
          تعديل
        </Button>
      ) : (
        <Button onClick={() => setOpen(true)} size="sm" variant="primary">
          <Plus aria-hidden className="size-4" />
          تخصص جديد
        </Button>
      )}

      <Modal
        description="التخصص يتبع القسم، ويظهر تلقائياً في قائمة التخصص عند إضافة أو تعديل طالب."
        onClose={() => setOpen(false)}
        open={open}
        size="xl"
        title={mode === "create" ? "إضافة تخصص" : `تعديل: ${specialization?.name ?? "التخصص"}`}
      >
        <form action={formAction} className="space-y-4" noValidate>
          {mode === "edit" && (
            <input name="specializationId" type="hidden" value={specialization?.id ?? ""} />
          )}

          <div className="space-y-4">
            <Field error={errorFor("departmentId")} htmlFor="departmentId" label="القسم" required>
              <Select
                defaultValue={valueFor("departmentId", specialization?.departmentId ?? "")}
                id="departmentId"
                name="departmentId"
                required
              >
                <option value="">اختر القسم</option>
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name} ({department.code})
                  </option>
                ))}
              </Select>
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field error={errorFor("name")} htmlFor="name" label="اسم التخصص" required>
                <Input
                  defaultValue={valueFor("name", specialization?.name ?? "")}
                  id="name"
                  name="name"
                  placeholder="مثال: حاسبات ومعلومات"
                  required
                />
              </Field>

              <Field
                error={errorFor("code")}
                hint="حروف إنجليزية وأرقام فقط، مثال: CS-SEC"
                htmlFor="code"
                label="كود التخصص"
                required
              >
                <Input
                  defaultValue={valueFor("code", specialization?.code ?? "")}
                  dir="ltr"
                  id="code"
                  name="code"
                  placeholder="CS-SEC"
                  required
                />
              </Field>
            </div>
          </div>

          <Field error={errorFor("description")} htmlFor="description" label="وصف مختصر">
            <Textarea
              defaultValue={valueFor("description", specialization?.description ?? "")}
              id="description"
              name="description"
              placeholder="مثال: التخصص المخصص لطلبة الفرقة الرابعة فما فوق."
              rows={3}
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
              {pending ? <Spinner /> : <Layers aria-hidden className="size-4" />}
              {pending ? "جارٍ الحفظ..." : "حفظ التخصص"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
