"use client";

import { Pencil, Plus } from "lucide-react";
import { useActionState, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Spinner } from "@/components/ui/loading";
import { Modal } from "@/components/ui/modal";
import type { SpecializationOption } from "@/lib/specializations";
import type { StudentEditData, StudentInput } from "@/lib/students";

import { createStudentAction, updateStudentAction, type StudentActionState } from "./actions";
import type { DepartmentOption } from "./student-filters";

const initialState: StudentActionState = { status: "idle" };

export function StudentFormDialog({
  mode,
  departments,
  specializations,
  student,
}: {
  mode: "create" | "edit";
  departments: DepartmentOption[];
  specializations?: SpecializationOption[];
  student?: StudentEditData;
}) {
  const [open, setOpen] = useState(false);
  const action = mode === "create" ? createStudentAction : updateStudentAction;
  const [state, formAction, pending] = useActionState(action, initialState);

  const [departmentId, setDepartmentId] = useState(student?.departmentId ?? "");
  const [specializationId, setSpecializationId] = useState(student?.specializationId ?? "");

  useEffect(() => {
    if (state.status === "success") setOpen(false);
  }, [state.status]);

  // Re-seed the controlled selects from the values echoed back after a rejection.
  useEffect(() => {
    if (state.status !== "error" || !state.values) return;
    setDepartmentId(state.values.departmentId ?? "");
    setSpecializationId(state.values.specializationId ?? "");
  }, [state.status, state.values]);

  const errorFor = (field: keyof StudentInput) => state.fieldErrors?.[field];
  const valueFor = (field: string, fallback: string) => state.values?.[field] ?? fallback;

  const departmentSpecializations = (specializations ?? []).filter(
    (specialization) => specialization.departmentId === departmentId,
  );

  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm" variant={mode === "create" ? "primary" : "secondary"}>
        {mode === "create" ? (
          <>
            <Plus aria-hidden className="size-4" />
            إضافة طالب
          </>
        ) : (
          <>
            <Pencil aria-hidden className="size-4" />
            تعديل
          </>
        )}
      </Button>

      <Modal
        description={
          mode === "create"
            ? "سيتم إنشاء حساب دخول للطالب بكلمة المرور المحددة."
            : "اترك كلمة المرور فارغة للإبقاء على كلمة المرور الحالية."
        }
        onClose={() => setOpen(false)}
        open={open}
        title={mode === "create" ? "إضافة طالب جديد" : `تعديل بيانات ${student?.fullName ?? "الطالب"}`}
      >
        <form action={formAction} className="space-y-4" noValidate>
          {mode === "edit" && <input name="studentId" type="hidden" value={student?.id ?? ""} />}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field error={errorFor("fullName")} htmlFor="fullName" label="الاسم الكامل" required>
              <Input
                defaultValue={valueFor("fullName", student?.fullName ?? "")}
                id="fullName"
                name="fullName"
                placeholder="مثال: أحمد محمد علي"
                required
              />
            </Field>

            <Field
              error={errorFor("serial")}
              hint="يأتي من عمود «رقم المسلسل» في ملف الإكسل المرفوع."
              htmlFor="serial"
              label="المسلسل"
            >
              <Input
                defaultValue={valueFor("serial", student?.serial ?? "")}
                dir="ltr"
                id="serial"
                name="serial"
                placeholder="1"
              />
            </Field>

            <Field error={errorFor("universityId")} htmlFor="universityId" label="الرقم الجامعي" required>
              <Input
                defaultValue={valueFor("universityId", student?.universityId ?? "")}
                dir="ltr"
                id="universityId"
                name="universityId"
                placeholder="20260001"
                required
              />
            </Field>

            <Field error={errorFor("email")} htmlFor="email" label="البريد الإلكتروني" required>
              <Input
                defaultValue={valueFor("email", student?.email ?? "")}
                dir="ltr"
                id="email"
                name="email"
                placeholder="student@university.edu"
                required
                type="email"
              />
            </Field>

            <Field error={errorFor("phone")} htmlFor="phone" label="رقم الهاتف">
              <Input
                defaultValue={valueFor("phone", student?.phone ?? "")}
                dir="ltr"
                id="phone"
                name="phone"
                placeholder="01000000000"
                type="tel"
              />
            </Field>

            <Field error={errorFor("departmentId")} htmlFor="departmentId" label="القسم" required>
              <Select
                id="departmentId"
                name="departmentId"
                onChange={(event) => {
                  setDepartmentId(event.target.value);
                  setSpecializationId("");
                }}
                required
                value={departmentId}
              >
                <option value="">اختر القسم</option>
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name} ({department.code})
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              error={errorFor("specializationId")}
              hint={
                departmentSpecializations.length === 0
                  ? "لا توجد تخصصات معرّفة لهذا القسم. أضفها من صفحة التخصصات."
                  : "يُستخدم أساساً لتخصيص طلبة الفرقة الرابعة فما فوق."
              }
              htmlFor="specializationId"
              label="التخصص"
            >
              <Select
                disabled={!departmentId || departmentSpecializations.length === 0}
                id="specializationId"
                name="specializationId"
                onChange={(event) => setSpecializationId(event.target.value)}
                value={specializationId}
              >
                <option value="">
                  {departmentSpecializations.length === 0 ? "لا يوجد تخصص" : "بدون تخصص"}
                </option>
                {departmentSpecializations.map((specialization) => (
                  <option key={specialization.id} value={specialization.id}>
                    {specialization.name} ({specialization.code})
                  </option>
                ))}
              </Select>
            </Field>

            <Field error={errorFor("academicYear")} htmlFor="academicYear" label="الفرقة الدراسية" required>
              <Select
                defaultValue={valueFor("academicYear", String(student?.academicYear ?? 1))}
                id="academicYear"
                name="academicYear"
                required
              >
                {[1, 2, 3, 4, 5, 6].map((year) => (
                  <option key={year} value={year}>
                    الفرقة {year}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field
            error={errorFor("password")}
            hint={
              mode === "edit"
                ? "اتركها فارغة للإبقاء على كلمة المرور الحالية"
                : "8 أحرف على الأقل، مثال: Student@2024"
            }
            htmlFor="password"
            label="كلمة المرور"
            required={mode === "create"}
          >
            <Input
              autoComplete="new-password"
              defaultValue={valueFor("password", "")}
              dir="ltr"
              id="password"
              name="password"
              placeholder="••••••••"
              required={mode === "create"}
              type="password"
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
              {pending ? "جارٍ الحفظ..." : mode === "create" ? "إضافة الطالب" : "حفظ التعديلات"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
