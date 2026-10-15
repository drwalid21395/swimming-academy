"use client";

import { Trash2 } from "lucide-react";
import { useActionState } from "react";

import { Spinner } from "@/components/ui/loading";

import { deleteQuestionAction, type QuestionActionState } from "./actions";

const initialState: QuestionActionState = { status: "idle" };

export function QuestionRowActions({
  questionId,
  snippet,
  usedInExams,
  canDelete,
}: {
  questionId: string;
  snippet: string;
  usedInExams: number;
  canDelete: boolean;
}) {
  const [state, formAction, deleting] = useActionState(deleteQuestionAction, initialState);

  if (!canDelete) return null;

  return (
    <div className="flex flex-col items-end gap-1">
      <form
        action={formAction}
        onSubmit={(event) => {
          const confirmed = window.confirm(
            `سيتم حذف السؤال نهائياً من بنك الأسئلة:\n\n${snippet.slice(0, 90)}\n\nهل تريد المتابعة؟`,
          );
          if (!confirmed) event.preventDefault();
        }}
      >
        <input name="questionId" type="hidden" value={questionId} />
        <button
          className="rounded-lg p-2 text-rose-600 transition hover:bg-rose-50 disabled:opacity-50 dark:hover:bg-rose-950/60"
          disabled={deleting}
          title={usedInExams > 0 ? "السؤال مرتبط بامتحان" : "حذف السؤال"}
          type="submit"
        >
          {deleting ? <Spinner /> : <Trash2 aria-hidden className="size-4" />}
        </button>
      </form>

      {state.status === "error" && state.message && (
        <p className="max-w-48 text-end text-xs font-medium text-rose-600" role="alert">
          {state.message}
        </p>
      )}
    </div>
  );
}
