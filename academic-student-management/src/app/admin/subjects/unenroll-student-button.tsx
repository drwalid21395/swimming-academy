"use client";

import { UserMinus } from "lucide-react";
import { useActionState } from "react";

import { Spinner } from "@/components/ui/loading";

import { unenrollStudentAction, type SubjectActionState } from "./actions";

const initialState: SubjectActionState = { status: "idle" };

export function UnenrollStudentButton({
  subjectId,
  studentId,
  studentName,
}: {
  subjectId: string;
  studentId: string;
  studentName: string;
}) {
  const [state, formAction, pending] = useActionState(unenrollStudentAction, initialState);

  return (
    <div className="flex flex-col items-end gap-1">
      <form
        action={formAction}
        onSubmit={(event) => {
          const confirmed = window.confirm(
            `سيتم إلغاء تسجيل "${studentName}" من المادة وحذف سجلات حضوره الخاصة بها. هل تريد المتابعة؟`,
          );
          if (!confirmed) event.preventDefault();
        }}
      >
        <input name="studentId" type="hidden" value={studentId} />
        <input name="subjectId" type="hidden" value={subjectId} />
        <button
          className="rounded-lg p-2 text-rose-600 transition hover:bg-rose-50 disabled:opacity-50 dark:hover:bg-rose-950/60"
          disabled={pending}
          title="إلغاء التسجيل"
          type="submit"
        >
          {pending ? <Spinner /> : <UserMinus aria-hidden className="size-4" />}
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
