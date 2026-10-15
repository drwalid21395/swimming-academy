"use client";

import { useActionState, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Spinner } from "@/components/ui/loading";
import { Modal } from "@/components/ui/modal";
import type { DepartmentFormValues } from "@/lib/departments";

import {
  createDepartmentAction,
  updateDepartmentAction,
  type DepartmentActionState,
} from "./actions";

const initialState: DepartmentActionState = { status: "idle" };

export type DepartmentProfessorOption = {
  id: string;
  fullName: string;
  employeeCode: string;
  departmentId: string;
  isActive: boolean;
};

export type DepartmentView = {
  id: string;
  name: string;
  code: string;
  description: string | null;
  head: { id: string; fullName: string; email: string } | null;
  professorsCount: number;
  subjectsCount: number;
  studentsCount: number;
};

export function DepartmentFormDialog({
  mode,
  department,
  professors,
}: {
  mode: "create" | "edit";
  department?: DepartmentView;
  professors: DepartmentProfessorOption[];
}) {
  const [open, setOpen] = useState(false);
  const action = mode === "create" ? createDepartmentAction : updateDepartmentAction;
  const [state, formAction, pending] = useActionState(action, initialState);

  useEffect(() => {
    if (state.status === "success") setOpen(false);
  }, [state.status]);

  const members = professors.filter(
    (professor) => professor.departmentId === department?.id,
  );
  const errorFor = (field: keyof DepartmentFormValues) => state.fieldErrors?.[field];
  const valueFor = (field: string, fallback: string) => state.values?.[field] ?? fallback;

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        size="sm"
        variant={mode === "create" ? "primary" : "secondary"}
      >
        {mode === "create" ? "إضافة قسم" : "تعديل"}
      </Button>

      <Modal
        description={
          mode === "create"
            ? "أضف قسماً جديداً لتنظيم المواد والدكاترة والطلاب."
            : "عدّل بيانات القسم وحدد رئيس القسم."
        }
        onClose={() => setOpen(false)}
        open={open}
        title={mode === "create" ? "إضافة قسم جديد" : `تعديل ${department?.name ?? "القسم"}`}
      >
        <form action={formAction} className="space-y-4" noValidate>
          {mode === "edit" && (
            <input name="departmentId" type="hidden" value={department?.id ?? ""} />
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field error={errorFor("name")} htmlFor="name" label="اسم القسم" required>
              <Input
                defaultValue={valueFor("name", department?.name ?? "")}
                id="name"
                name="name"
                placeholder="قسم علوم الحاسب"
                required
              />
            </Field>

            <Field
              error={errorFor("code")}
              hint="كود مختصر بالإنجليزية"
              htmlFor="code"
              label="كود القسم"
              required
            >
              <Input
                defaultValue={valueFor("code", department?.code ?? "")}
                dir="ltr"
                id="code"
                name="code"
                placeholder="CS"
                required
              />
            </Field>
          </div>

          {mode === "edit" && (
            <Field
              error={errorFor("headId")}
              hint="رئيس القسم يختار من أعضاء هذا القسم فقط"
              htmlFor="headId"
              label="رئيس القسم"
            >
              <Select
                defaultValue={valueFor("headId", department?.head?.id ?? "")}
                id="headId"
                name="headId"
              >
                <option value="">غير محدد</option>
                {members.map((professor) => (
                  <option key={professor.id} value={professor.id}>
                    {professor.fullName} ({professor.employeeCode})
                  </option>
                ))}
              </Select>
              {members.length === 0 && (
                <p className="text-xs text-amber-600" role="alert">
                  لا يوجد أعضاء هيئة تدريس في هذا القسم حتى الآن.
                </p>
              )}
            </Field>
          )}

          {mode === "create" && (
            <p className="rounded-2xl bg-slate-500/10 px-4 py-3 text-xs font-medium leading-6 text-muted">
              للبدء أنشئ القسم، وبعد إضافة دكاترة إليه يمكنك تعيين رئيس القسم من
              زر «تعديل».
            </p>
          )}

          <Field error={errorFor("description")} htmlFor="description" label="وصف القسم">
            <Textarea
              defaultValue={valueFor("description", department?.description ?? "")}
              id="description"
              name="description"
              placeholder="وصف مختصر للقسم واختصاصاته..."
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
              {pending ? "جارٍ الحفظ..." : mode === "create" ? "إضافة القسم" : "حفظ التعديلات"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}