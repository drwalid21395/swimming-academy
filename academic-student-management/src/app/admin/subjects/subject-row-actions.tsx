"use client";

import { Trash2 } from "lucide-react";
import { useActionState } from "react";

import { Spinner } from "@/components/ui/loading";

import { deleteSubjectAction, type SubjectActionState } from "./actions";

const initialState: SubjectActionState = { status: "idle" };

export function SubjectRowActions({
  subjectId,
  subjectName,
  canDelete,
}: {
  subjectId: string;
  subjectName: string;
  canDelete: boolean;
}) {
  const [state, formAction, deleting] = useActionState(deleteSubjectAction, initialState);

  if (!canDelete) return null;

  return (
    <div className="flex flex-col items-end gap-1">
      <form
        action={formAction}
        onSubmit={(event) => {
          const confirmed = window.confirm(
            `سيتم حذف المادة "${subjectName}" مع تسجيلات الطلاب وسجلات الحضور والامتحانات نهائياً. هل تريد المتابعة؟`,
          );
          if (!confirmed) event.preventDefault();
        }}
      >
        <input name="subjectId" type="hidden" value={subjectId} />
        <button
          className="rounded-lg p-2 text-rose-600 transition hover:bg-rose-50 disabled:opacity-50 dark:hover:bg-rose-950/60"
          disabled={deleting}
          title="حذف المادة"
          type="submit"
        >
          {deleting ? <Spinner /> : <Trash2 aria-hidden className="size-4" />}
        </button>
      </form>

      {state.status === "error" && state.message && (
        <p className="text-xs font-medium text-rose-600" role="alert">
          {state.message}
        </p>
      )}
    </div>
  );
}
