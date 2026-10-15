"use client";

import { Pencil, Star, UserPlus } from "lucide-react";
import { useActionState, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Spinner } from "@/components/ui/loading";
import { Modal } from "@/components/ui/modal";
import type { ProfessorEditData, ProfessorInput } from "@/lib/professors";
import { ASSISTANT_DEFAULT_GRANTS } from "@/lib/professor-permissions";

import { createProfessorAction, updateProfessorAction, type ProfessorPermissionActionState } from "./actions";

const initialState: ProfessorPermissionActionState = { status: "idle" };

export type ProfessorSubjectOption = {
  id: string;
  code: string;
  name: string;
  departmentName: string;
};

export type ProfessorPermissionOption = {
  key: string;
  label: string;
  description: string;
};

export type ProfessorSupervisorOption = {
  professorId: string;
  fullName: string;
  employeeCode: string;
  departmentName: string;
  subjectIds: string[];
};

export function ProfessorFormDialog({
  mode,
  departments,
  subjectOptions,
  supervisorOptions,
  permissionOptions,
  professor,
  initiallyOpen = false,
}: {
  mode: "create" | "edit";
  departments: { id: string; name: string; code: string }[];
  subjectOptions: ProfessorSubjectOption[];
  supervisorOptions: ProfessorSupervisorOption[];
  permissionOptions: ProfessorPermissionOption[];
  professor?: ProfessorEditData;
  initiallyOpen?: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const [kind, setKind] = useState<"PROFESSOR" | "ASSISTANT">(professor?.kind ?? "PROFESSOR");
  const [supervisorId, setSupervisorId] = useState(professor?.supervisorId ?? "");
  const [selectedSubjectIds, setSelectedSubjectIds] = useState<string[]>(
    professor?.subjectIds ?? [],
  );
  const action = mode === "create" ? createProfessorAction : updateProfessorAction;
  const [state, formAction, pending] = useActionState(action, initialState);

  useEffect(() => {
    if (state.status === "success") setOpen(false);
  }, [state.status]);

  const errorFor = (field: keyof ProfessorInput) => state.fieldErrors?.[field];
  const valueFor = (field: string, fallback: string) => state.values?.[field] ?? fallback;

const grantedKeys = new Set(professor?.permissionKeys ?? []);
const assistantDefaultKeys = new Set<string>(ASSISTANT_DEFAULT_GRANTS);
const isAssistant = kind === "ASSISTANT";

  // An assistant can never reach beyond the subjects of the professor supervising him.
  const supervisor = supervisorOptions.find((option) => option.professorId === supervisorId);
  const visibleSubjects =
    isAssistant && supervisor
      ? subjectOptions.filter((subject) => supervisor.subjectIds.includes(subject.id))
      : subjectOptions;

  // Changing the supervisor must not leave subjects the new supervisor cannot teach.
  function handleSupervisorChange(nextSupervisorId: string) {
    setSupervisorId(nextSupervisorId);
    const next = supervisorOptions.find((option) => option.professorId === nextSupervisorId);
    if (!next) return;
    setSelectedSubjectIds((previous) => previous.filter((id) => next.subjectIds.includes(id)));
  }

  function handleKindChange(nextKind: "PROFESSOR" | "ASSISTANT") {
    setKind(nextKind);
    if (nextKind === "PROFESSOR") setSupervisorId("");
  }

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        size="sm"
        variant={mode === "create" ? "primary" : "secondary"}
      >
        {mode === "create" ? (
          <>
            <UserPlus aria-hidden className="size-4" />
            إضافة دكتور
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
            ? "سيتم إنشاء حساب دخول باسم مستخدم وكلمة مرور تحددهما، مع إسناد المواد والصلاحيات."
            : "لتغيير كلمة المرور اترك حقلها فارغاً."
        }
        onClose={() => setOpen(false)}
        open={open}
        size="lg"
        title={
          mode === "create"
            ? isAssistant
              ? "إضافة عضو هيئة معاونة"
              : "إضافة دكتور جديد"
            : `تعديل: ${professor?.fullName ?? "الحساب"}`
        }
      >
        <form action={formAction} className="space-y-5" noValidate>
          {mode === "edit" && <input name="professorId" type="hidden" value={professor?.id ?? ""} />}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field error={errorFor("fullName")} htmlFor="fullName" label="الاسم الكامل" required>
              <Input
                defaultValue={valueFor("fullName", professor?.fullName ?? "")}
                id="fullName"
                name="fullName"
                placeholder="مثال: د. وليد عبد الرحمن"
                required
              />
            </Field>

            <Field
              error={errorFor("email")}
              hint="يستخدم كاسم مستخدم للدخول"
              htmlFor="email"
              label="اسم المستخدم (البريد)"
              required
            >
              <Input
                defaultValue={valueFor("email", professor?.email ?? "")}
                dir="ltr"
                id="email"
                name="email"
                placeholder="professor@university.edu"
                required
                type="email"
              />
            </Field>

            <Field error={errorFor("employeeCode")} htmlFor="employeeCode" label="الرقم الوظيفي" required>
              <Input
                defaultValue={valueFor("employeeCode", professor?.employeeCode ?? "")}
                dir="ltr"
                id="employeeCode"
                name="employeeCode"
                placeholder="EMP-1001"
                required
              />
            </Field>

            <Field error={errorFor("phone")} htmlFor="phone" label="رقم الهاتف">
              <Input
                defaultValue={valueFor("phone", professor?.phone ?? "")}
                dir="ltr"
                id="phone"
                name="phone"
                placeholder="01000000000"
                type="tel"
              />
            </Field>

            <Field error={errorFor("departmentId")} htmlFor="departmentId" label="القسم" required>
              <Select
                defaultValue={valueFor("departmentId", professor?.departmentId ?? "")}
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

            <Field
              error={errorFor("password")}
              hint={
                mode === "edit"
                  ? "اتركها فارغة للإبقاء على كلمة المرور الحالية"
                  : "8 أحرف على الأقل، مثال: Professor@2026"
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

            {mode === "create" && (
              <Field htmlFor="kind" label="الصفة" required>
                <Select
                  id="kind"
                  name="kind"
                  onChange={(event) =>
                    handleKindChange(event.target.value as "PROFESSOR" | "ASSISTANT")
                  }
                  required
                  value={kind}
                >
                  <option value="PROFESSOR">دكتور (عضو هيئة تدريس)</option>
                  <option value="ASSISTANT">عضو هيئة معاونة</option>
                </Select>
              </Field>
            )}
            {mode === "edit" && (
              <input name="kind" type="hidden" value={professor?.kind ?? "PROFESSOR"} />
            )}

            {isAssistant && (
              <Field
                error={errorFor("supervisorId")}
                hint="لا يمكن للمعاون تجاوز مواد مشرفه"
                htmlFor="supervisorId"
                label="الدكتور المشرف"
                required
              >
                <Select
                  id="supervisorId"
                  name="supervisorId"
                  onChange={(event) => handleSupervisorChange(event.target.value)}
                  required
                  value={supervisorId}
                >
                  <option value="">اختر الدكتور المشرف</option>
                  {supervisorOptions.map((option) => (
                    <option key={option.professorId} value={option.professorId}>
                      {option.fullName} ({option.employeeCode}) · {option.subjectIds.length} مادة
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {!isAssistant && <input name="supervisorId" type="hidden" value="" />}

            {mode === "edit" && (
              <Field htmlFor="isActive" label="حالة الحساب">
                <Select defaultValue={professor?.isActive ? "1" : "0"} id="isActive" name="isActive">
                  <option value="1">نشط (يستطيع الدخول)</option>
                  <option value="0">موقوف (لا يستطيع الدخول)</option>
                </Select>
              </Field>
            )}
            {mode === "create" && <input name="isActive" type="hidden" value="1" />}
          </div>

          <div>
            <p className="mb-2 text-sm font-bold text-[var(--app-text)]">
              المواد المسموحة
              <span className="ms-2 text-xs font-normal text-muted">
                {isAssistant
                  ? "اتركها فارغة ليأخذ المعاون كل مواد الدكتور المشرف تلقائياً، أو حدد مواد لتقييده."
                  : "هذه المواد فقط هي ما سيراه الدكتور في صفحاته."}
              </span>
            </p>
            {isAssistant && !supervisor ? (
              <p className="rounded-2xl bg-amber-500/12 px-4 py-3 text-sm font-semibold text-amber-700 ring-1 ring-inset ring-amber-500/25 dark:text-amber-300">
                اختر الدكتور المشرف أولاً حتى تظهر موادك المسموحة.
              </p>
            ) : (
              <div className="max-h-64 space-y-2 overflow-y-auto rounded-2xl border border-[var(--glass-border)] p-3">
                {visibleSubjects.length === 0 ? (
                  <p className="p-3 text-sm text-muted">
                    {isAssistant
                      ? "لا يملك الدكتور المشرف مواد يمكن إسنادها."
                      : "لا توجد مواد في النظام."}
                  </p>
                ) : (
                  visibleSubjects.map((subject) => {
                    const assigned = selectedSubjectIds.includes(subject.id);
                    const isPrimary = assigned && selectedSubjectIds[0] === subject.id;

                    return (
                      <div key={subject.id}>
                        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-right text-sm transition hover:bg-[var(--glass-bg)] has-[:checked]:bg-brand-500/12 has-[:checked]:font-semibold">
                          <input
                            checked={assigned}
                            className="peer sr-only"
                            name="subjectIds"
                            onChange={(event) => {
                              setSelectedSubjectIds((previous) =>
                                event.target.checked
                                  ? [...previous, subject.id]
                                  : previous.filter((id) => id !== subject.id),
                              );
                            }}
                            type="checkbox"
                            value={subject.id}
                          />
                          <span className="min-w-0">
                            <span className="block truncate">{subject.name}</span>
                            <span className="block text-xs text-muted" dir="ltr">
                              {subject.code} · {subject.departmentName}
                            </span>
                          </span>
                          <span className="shrink-0 rounded-md bg-white/60 px-2 py-0.5 text-xs font-semibold text-muted peer-checked:bg-brand-500/20 peer-checked:text-brand-700 dark:bg-white/10 dark:peer-checked:text-brand-200">
                            {assigned ? "محددة" : "غير محددة"}
                          </span>
                        </label>

                        {assigned && (
                          <label className="mt-1 flex cursor-pointer items-center gap-2 px-3 pb-2 text-xs text-muted">
                            <input
                              checked={isPrimary}
                              className="size-3.5 accent-amber-500"
                              name="primarySubjectId"
                              onChange={() =>
                                setSelectedSubjectIds((previous) => [
                                  subject.id,
                                  ...previous.filter((id) => id !== subject.id),
                                ])
                              }
                              type="radio"
                              value={subject.id}
                            />
                            <Star aria-hidden className="size-3" />
                            مادة المحاضر الأساسي (تظهر باسمه في البوابة العامة)
                          </label>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>

          <div>
            <p className="mb-2 text-sm font-bold text-[var(--app-text)]">
              الصلاحيات
              {isAssistant && (
                <span className="ms-2 text-xs font-normal text-muted">
                  الافتراضي للمعاون: تسجيل الحضور فقط.
                </span>
              )}
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {permissionOptions.map((permission) => {
                const checked =
                  mode === "create"
                    ? isAssistant && assistantDefaultKeys.has(permission.key)
                    : grantedKeys.has(permission.key);

                return (
                  <label
                    className="flex cursor-pointer gap-3 rounded-2xl p-3 ring-1 ring-inset ring-[var(--glass-border)] transition hover:bg-[var(--glass-bg)] has-[:checked]:bg-brand-500/10"
                    key={permission.key}
                  >
                    <input
                      className="mt-1 size-4 accent-[var(--brand-500)]"
                      defaultChecked={checked}
                      name="permissionKeys"
                      type="checkbox"
                      value={permission.key}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-bold text-[var(--app-text)]">
                        {permission.label}
                      </span>
                      <span className="mt-0.5 block text-xs leading-5 text-muted">
                        {permission.description}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
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
            <Button onClick={() => setOpen(false)} type="button" variant="secondary">
              إلغاء
            </Button>
            <Button disabled={pending} type="submit">
              {pending ? <Spinner /> : <UserPlus aria-hidden className="size-4" />}
              {pending
                ? "جارٍ الحفظ..."
                : mode === "create"
                  ? isAssistant
                    ? "إضافة عضو المعاونة"
                    : "إضافة الدكتور"
                  : "حفظ التعديلات"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}