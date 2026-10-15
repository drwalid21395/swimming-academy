"use client";

import { useActionState, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Spinner } from "@/components/ui/loading";
import { Modal } from "@/components/ui/modal";
import type { SubjectEditData, SubjectFormValues } from "@/lib/subjects";

import { createSubjectAction, updateSubjectAction, type SubjectActionState } from "./actions";

const initialState: SubjectActionState = { status: "idle" };

export type ProfessorOption = {
  id: string;
  fullName: string;
  employeeCode: string;
  departmentId: string;
  isActive: boolean;
};

export type TermOption = { id: string; name: string; isCurrent: boolean };
export type DepartmentRef = { id: string; name: string; code: string };

export function SubjectFormDialog({
  mode,
  departments,
  terms,
  professors,
  subject,
  initiallyOpen = false,
}: {
  mode: "create" | "edit";
  departments: DepartmentRef[];
  terms: TermOption[];
  professors: ProfessorOption[];
  subject?: SubjectEditData;
  /** Opens the dialog on first render so the form is reachable via ?new=1. */
  initiallyOpen?: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const [departmentId, setDepartmentId] = useState(
    subject?.departmentId ?? departments[0]?.id ?? "",
  );

  const action = mode === "create" ? createSubjectAction : updateSubjectAction;
  const [state, formAction, pending] = useActionState(action, initialState);

  useEffect(() => {
    if (state.status === "success") setOpen(false);
  }, [state.status]);

  const defaultTerm = terms.find((term) => term.isCurrent) ?? terms[0];
  const matchingProfessors = professors.filter(
    (professor) => professor.departmentId === departmentId,
  );
  const legacyProfessor = subject?.professorId
    ? professors.find(
        (professor) =>
          professor.id === subject.professorId && professor.departmentId !== departmentId,
      )
    : undefined;

  const errorFor = (field: keyof SubjectFormValues) => state.fieldErrors?.[field];
  const valueFor = (field: string, fallback: string) => state.values?.[field] ?? fallback;

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        size="sm"
        variant={mode === "create" ? "primary" : "secondary"}
      >
        {mode === "create" ? "إضافة مادة" : "تعديل"}
      </Button>

      <Modal
        description={
          mode === "create"
            ? "أضف مادة دراسية وحدد القسم والأستاذ المسؤول."
            : "تعديل بيانات المادة وتعيين الأستاذ الأساسي."
        }
        onClose={() => setOpen(false)}
        open={open}
        title={mode === "create" ? "إضافة مادة دراسية" : `تعديل ${subject?.name ?? "المادة"}`}
      >
        <form action={formAction} className="space-y-4" noValidate>
          {mode === "edit" && <input name="subjectId" type="hidden" value={subject?.id ?? ""} />}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field error={errorFor("code")} hint="مثال: CS101" htmlFor="code" label="كود المادة" required>
              <Input
                defaultValue={valueFor("code", subject?.code ?? "")}
                dir="ltr"
                id="code"
                name="code"
                placeholder="CS101"
                required
              />
            </Field>

            <Field error={errorFor("name")} htmlFor="name" label="اسم المادة" required>
              <Input
                defaultValue={valueFor("name", subject?.name ?? "")}
                id="name"
                name="name"
                placeholder="مقدمة في البرمجة"
                required
              />
            </Field>

            <Field error={errorFor("departmentId")} htmlFor="departmentId" label="القسم" required>
              <Select
                defaultValue={valueFor("departmentId", subject?.departmentId ?? departmentId)}
                id="departmentId"
                name="departmentId"
                onChange={(event) => setDepartmentId(event.target.value)}
                required
              >
                <option value="">اختر القسم</option>
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field error={errorFor("academicTermId")} htmlFor="academicTermId" label="الفصل الدراسي" required>
              <Select
                defaultValue={valueFor("academicTermId", subject?.academicTermId ?? defaultTerm?.id ?? "")}
                id="academicTermId"
                name="academicTermId"
                required
              >
                <option value="">اختر الفصل</option>
                {terms.map((term) => (
                  <option key={term.id} value={term.id}>
                    {term.name}
                    {term.isCurrent ? " (الحالي)" : ""}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              error={errorFor("professorId")}
              htmlFor="professorId"
              hint="يتم عرض أعضاء القسم المختار فقط"
              label="عضو هيئة التدريس"
              required
            >
              <Select
                defaultValue={valueFor("professorId", subject?.professorId ?? "")}
                id="professorId"
                name="professorId"
                required
              >
                <option value="">اختر الأستاذ</option>
                {matchingProfessors.map((professor) => (
                  <option key={professor.id} value={professor.id}>
                    {professor.fullName} ({professor.employeeCode})
                  </option>
                ))}
                {legacyProfessor && (
                  <optgroup label="الأستاذ الحالي (من قسم آخر)">
                    <option value={legacyProfessor.id}>
                      {legacyProfessor.fullName} ({legacyProfessor.employeeCode})
                    </option>
                  </optgroup>
                )}
              </Select>
              {matchingProfessors.length === 0 && !legacyProfessor && (
                <p className="text-xs text-amber-600" role="alert">
                  لا يوجد أعضاء هيئة تدريس في هذا القسم بعد.
                </p>
              )}
            </Field>

            <Field error={errorFor("creditHours")} htmlFor="creditHours" label="عدد الساعات" required>
              <Input
                defaultValue={valueFor("creditHours", String(subject?.creditHours ?? 3))}
                dir="ltr"
                id="creditHours"
                max={12}
                min={1}
                name="creditHours"
                required
                type="number"
              />
            </Field>

            <Field
              error={errorFor("attendanceLimit")}
              hint="النسبة الدنيا المسموح بها (75٪ مثال)"
              htmlFor="attendanceLimit"
              label="حد الحضور ٪"
              required
            >
              <Input
                defaultValue={valueFor("attendanceLimit", String(subject?.attendanceLimit ?? 75))}
                dir="ltr"
                id="attendanceLimit"
                max={100}
                min={0}
                name="attendanceLimit"
                required
                type="number"
              />
            </Field>
          </div>

          <Field error={errorFor("description")} htmlFor="description" label="وصف المادة">
            <Textarea
              defaultValue={valueFor("description", subject?.description ?? "")}
              id="description"
              name="description"
              placeholder="وصف مختصر لمحتوى المادة وأهدافها..."
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
              {pending ? "جارٍ الحفظ..." : mode === "create" ? "إضافة المادة" : "حفظ التعديلات"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
