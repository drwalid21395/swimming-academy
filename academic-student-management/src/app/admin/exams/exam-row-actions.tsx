"use client";

import { Archive, Lock, Send, Trash2, Undo2 } from "lucide-react";
import { useActionState } from "react";
import type { ExamStatus } from "@prisma/client";

import { Spinner } from "@/components/ui/loading";

import { deleteExamAction, setExamStatusAction, type ExamActionState } from "./actions";

const initialState: ExamActionState = { status: "idle" };

type StatusTarget = "PUBLISHED" | "CLOSED" | "DRAFT";

export function ExamRowActions({
  examId,
  examTitle,
  status,
  questionsCount,
  canManage,
  canPublish,
  canDelete,
}: {
  examId: string;
  examTitle: string;
  status: ExamStatus;
  questionsCount: number;
  canManage: boolean;
  canPublish: boolean;
  canDelete: boolean;
}) {
  const [publishState, publishAction, publishing] = useActionState(
    setExamStatusAction,
    initialState,
  );
  const [deleteState, deleteAction, deleting] = useActionState(deleteExamAction, initialState);

  const error =
    publishState.status === "error"
      ? publishState.message
      : deleteState.status === "error"
        ? deleteState.message
        : null;

  const statusAction = (target: StatusTarget, confirm?: string) => (
    <form
      action={publishAction}
      onSubmit={(event) => {
        if (confirm && !window.confirm(confirm)) event.preventDefault();
      }}
    >
      <input name="examId" type="hidden" value={examId} />
      <input name="status" type="hidden" value={target} />
      <button
        className={buttonTone[target]}
        disabled={publishing || (target === "PUBLISHED" && questionsCount === 0)}
        title={
          target === "PUBLISHED" && questionsCount === 0 ? "أضف أسئلة قبل النشر" : statusTitle[target]
        }
        type="submit"
      >
        {publishing ? <Spinner /> : statusIcon[target]}
      </button>
    </form>
  );

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center justify-end gap-1.5">
        {canPublish && status === "DRAFT" &&
          statusAction(
            "PUBLISHED",
            `سيتم نشر الامتحان «${examTitle}» وإتاحته للطلاب المسجلين. هل تريد المتابعة؟`,
          )}

        {canPublish && status === "PUBLISHED" &&
          statusAction(
            "CLOSED",
            "سيتم إغلاق الامتحان ومنع تسليم إجابات جديدة. هل تريد المتابعة؟",
          )}

        {canManage && (status === "CLOSED" || status === "ARCHIVED") &&
          statusAction("DRAFT", "سيتم إرجاع الامتحان إلى حالة المسودة. هل تريد المتابعة؟")}

        {canDelete && (
          <form
            action={deleteAction}
            onSubmit={(event) => {
              const confirmed = window.confirm(
                `سيتم حذف الامتحان «${examTitle}» وكل أسئلته نهائياً. هل تريد المتابعة؟`,
              );
              if (!confirmed) event.preventDefault();
            }}
          >
            <input name="examId" type="hidden" value={examId} />
            <button
              className="rounded-lg p-2 text-rose-600 transition hover:bg-rose-50 disabled:opacity-50 dark:hover:bg-rose-950/60"
              disabled={deleting}
              title="حذف الامتحان"
              type="submit"
            >
              {deleting ? <Spinner /> : <Trash2 aria-hidden className="size-4" />}
            </button>
          </form>
        )}
      </div>

      {error && (
        <p className="text-xs font-medium text-rose-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

const statusIcon = {
  PUBLISHED: <Send aria-hidden className="size-4" />,
  CLOSED: <Lock aria-hidden className="size-4" />,
  DRAFT: <Undo2 aria-hidden className="size-4" />,
} as const;

const buttonTone = {
  PUBLISHED: "rounded-lg p-2 text-emerald-600 transition hover:bg-emerald-50 dark:hover:bg-emerald-950/60",
  CLOSED: "rounded-lg p-2 text-amber-600 transition hover:bg-amber-50 dark:hover:bg-amber-950/60",
  DRAFT: "rounded-lg p-2 text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
} as const;

const statusTitle = {
  PUBLISHED: "نشر الامتحان",
  CLOSED: "إغلاق الامتحان",
  DRAFT: "إرجاع إلى المسودة",
} as const;
