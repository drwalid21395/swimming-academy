"use client";

import { Trash2, UserCheck, UserX } from "lucide-react";
import { useActionState } from "react";

import { Spinner } from "@/components/ui/loading";
import type { StudentEditData } from "@/lib/students";

import {
  deleteStudentAction,
  setStudentActiveAction,
  type StudentActionState,
} from "./actions";

const initialState: StudentActionState = { status: "idle" };

export function StudentRowActions({
  student,
  canDelete,
}: {
  student: StudentEditData;
  canDelete: boolean;
}) {
  const [deleteState, deleteAction, deleting] = useActionState(deleteStudentAction, initialState);
  const [activeState, activeAction, toggling] = useActionState(setStudentActiveAction, initialState);

  const busy = deleting || toggling;
  const actionError = deleteState.status === "error" ? deleteState.message : activeState.status === "error" ? activeState.message : null;

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center justify-end gap-1.5">
        <form action={activeAction}>
          <input name="studentId" type="hidden" value={student.id} />
          <input name="isActive" type="hidden" value={String(!student.isActive)} />
          <button
            className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            disabled={busy}
            title={student.isActive ? "إيقاف الحساب" : "تفعيل الحساب"}
            type="submit"
          >
            {toggling ? (
              <Spinner />
            ) : student.isActive ? (
              <UserX aria-hidden className="size-4" />
            ) : (
              <UserCheck aria-hidden className="size-4" />
            )}
          </button>
        </form>

        {canDelete && (
          <form
            action={deleteAction}
            onSubmit={(event) => {
              const confirmed = window.confirm(
                `سيتم حذف الطالب "${student.fullName}" وجميع سجلات حضوره ودرجاته نهائياً. هل تريد المتابعة؟`,
              );
              if (!confirmed) event.preventDefault();
            }}
          >
            <input name="studentId" type="hidden" value={student.id} />
            <button
              className="rounded-lg p-2 text-rose-600 transition hover:bg-rose-50 disabled:opacity-50 dark:hover:bg-rose-950/60"
              disabled={busy}
              title="حذف الطالب"
              type="submit"
            >
              {deleting ? <Spinner /> : <Trash2 aria-hidden className="size-4" />}
            </button>
          </form>
        )}
      </div>

      {actionError && (
        <p className="text-xs font-medium text-rose-600" role="alert">
          {actionError}
        </p>
      )}
    </div>
  );
}
