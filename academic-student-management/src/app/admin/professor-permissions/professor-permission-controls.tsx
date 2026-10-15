"use client";

import { Check, Loader2, Minus, X } from "lucide-react";
import { useActionState, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  saveProfessorScopeAction,
  toggleProfessorPermissionAction,
  type ProfessorPermissionActionState,
} from "./actions";

const initialState: ProfessorPermissionActionState = { status: "idle" };

export type ProfessorScopeRow = {
  professorId: string;
  fullName: string;
  subjectIds: string[];
  subjectNames: string[];
};

export type ProfessorScopeOption = {
  id: string;
  code: string;
  name: string;
  departmentName: string;
};

export function PermissionToggle({
  professorId,
  permissionKey,
  permissionLabel,
  granted,
}: {
  professorId: string;
  permissionKey: string;
  permissionLabel: string;
  granted: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    toggleProfessorPermissionAction,
    initialState,
  );

  return (
    <form action={formAction} className="contents">
      <input name="professorId" type="hidden" value={professorId} />
      <input name="permission" type="hidden" value={permissionKey} />
      <input name="intent" type="hidden" value={granted ? "revoke" : "grant"} />

      <Button
        aria-label={`${granted ? "سحب" : "منح"} ${permissionLabel}`}
        className="min-w-28"
        disabled={pending}
        size="sm"
        title={state.status === "error" ? state.message : undefined}
        type="submit"
        variant={granted ? "subtle" : "outline"}
      >
        {pending ? (
          <Loader2 aria-hidden className="size-4 animate-spin" />
        ) : granted ? (
          <Check aria-hidden className="size-4" />
        ) : (
          <X aria-hidden className="size-4" />
        )}
        {granted ? "ممنوحة" : "غير ممنوحة"}
      </Button>
    </form>
  );
}

export function SubjectScopeDialog({
  professor,
  subjectOptions,
}: {
  professor: ProfessorScopeRow;
  subjectOptions: ProfessorScopeOption[];
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>(professor.subjectIds);
  const [state, formAction, pending] = useActionState(saveProfessorScopeAction, initialState);

  useEffect(() => {
    setSelected(professor.subjectIds);
  }, [professor.subjectIds]);

  useEffect(() => {
    if (state.status === "success") setOpen(false);
  }, [state]);

  const toggle = (id: string) => {
    setSelected((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  };

  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm" type="button" variant="secondary">
        المواد المسموحة
      </Button>

      <Modal
        description="هذه المواد هي كل ما سيراه الدكتور في صفحاته. أي مادة غير مدرجة هنا لن تظهر له، ولن يستطيع تنفيذ أي إجراء فيها."
        onClose={() => setOpen(false)}
        open={open}
        size="lg"
        title={`نطاق المواد · ${professor.fullName}`}
      >
        <form action={formAction} className="space-y-4">
          <input name="professorId" type="hidden" value={professor.professorId} />
          {selected.map((id) => (
            <input key={id} name="subjectIds" type="hidden" value={id} />
          ))}

          <div className="max-h-80 space-y-2 overflow-y-auto rounded-2xl border border-[var(--glass-border)] p-3">
            {subjectOptions.length === 0 ? (
              <p className="p-3 text-sm text-muted">لا توجد مواد في النظام.</p>
            ) : (
              subjectOptions.map((subject) => {
                const active = selected.includes(subject.id);

                return (
                  <button
                    aria-pressed={active}
                    className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-right text-sm transition ${
                      active
                        ? "bg-brand-500/12 font-semibold text-brand-700 dark:text-brand-200"
                        : "text-muted hover:bg-[var(--glass-bg)]"
                    }`}
                    key={subject.id}
                    onClick={() => toggle(subject.id)}
                    type="button"
                  >
                    <span className="min-w-0">
                      <span className="block truncate">{subject.name}</span>
                      <span className="block text-xs text-muted" dir="ltr">
                        {subject.code} · {subject.departmentName}
                      </span>
                    </span>
                    <Badge tone={active ? "success" : "neutral"}>
                      {active ? <Check aria-hidden className="size-3" /> : <Minus aria-hidden className="size-3" />}
                      {active ? "مسموحة" : "ممنوعة"}
                    </Badge>
                  </button>
                );
              })
            )}
          </div>

          {state.status === "error" && (
            <p className="rounded-xl bg-rose-500/10 px-3 py-2 text-sm font-medium text-rose-700 dark:text-rose-300">
              {state.message}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted">
              {subjectOptions.length} مادة في النظام · {selected.length} مادة مسموحة.
            </p>
            <div className="flex gap-2">
              <Button onClick={() => setOpen(false)} type="button" variant="ghost">
                إلغاء
              </Button>
              <Button disabled={pending} type="submit" variant="primary">
                {pending && <Loader2 aria-hidden className="size-4 animate-spin" />}
                حفظ النطاق
              </Button>
            </div>
          </div>
        </form>
      </Modal>
    </>
  );
}
