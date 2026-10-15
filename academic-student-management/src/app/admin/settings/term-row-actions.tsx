"use client";

import { CheckCircle2, Trash2 } from "lucide-react";
import { useActionState } from "react";

import { Spinner } from "@/components/ui/loading";

import { deleteTermAction, setCurrentTermAction, type SettingsActionState } from "./actions";

const initialState: SettingsActionState = { status: "idle" };

export function TermRowActions({
  termId,
  name,
  isCurrent,
  canDelete,
}: {
  termId: string;
  name: string;
  isCurrent: boolean;
  canDelete: boolean;
}) {
  const [activateState, activateAction, activating] = useActionState(
    setCurrentTermAction,
    initialState,
  );
  const [deleteState, deleteAction, deleting] = useActionState(deleteTermAction, initialState);

  const error =
    activateState.status === "error"
      ? activateState.message
      : deleteState.status === "error"
        ? deleteState.message
        : null;

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center justify-end gap-1.5">
        {!isCurrent && (
          <form action={activateAction}>
            <input name="termId" type="hidden" value={termId} />
            <button
              className="rounded-lg p-2 text-emerald-600 transition hover:bg-emerald-50 disabled:opacity-50 dark:hover:bg-emerald-950/60"
              disabled={activating}
              title="تعيينه الفصل الدراسي الحالي"
              type="submit"
            >
              {activating ? <Spinner /> : <CheckCircle2 aria-hidden className="size-4" />}
            </button>
          </form>
        )}

        {canDelete && (
          <form
            action={deleteAction}
            onSubmit={(event) => {
              const confirmed = window.confirm(
                `سيتم حذف الفصل الدراسي "${name}" نهائياً. لا يمكن حذف فصل مرتبط بمواد دراسية. هل تريد المتابعة؟`,
              );
              if (!confirmed) event.preventDefault();
            }}
          >
            <input name="termId" type="hidden" value={termId} />
            <button
              className="rounded-lg p-2 text-rose-600 transition hover:bg-rose-50 disabled:opacity-50 dark:hover:bg-rose-950/60"
              disabled={deleting}
              title="حذف الفصل الدراسي"
              type="submit"
            >
              {deleting ? <Spinner /> : <Trash2 aria-hidden className="size-4" />}
            </button>
          </form>
        )}
      </div>

      {error && (
        <p className="max-w-48 text-end text-xs font-medium text-rose-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
