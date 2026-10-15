"use client";

import { PlayCircle, TriangleAlert } from "lucide-react";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/loading";

import { startExamAction, type AttemptActionState } from "./actions";

const initialState: AttemptActionState = { status: "idle" };

export function StartExamButton({
  examId,
  label,
  disabled,
  hint,
  danger,
}: {
  examId: string;
  label: string;
  disabled?: boolean;
  hint?: string;
  danger?: boolean;
}) {
  const [state, formAction, pending] = useActionState(startExamAction, initialState);

  return (
    <div className="space-y-2">
      <form action={formAction}>
        <input name="examId" type="hidden" value={examId} />
        <Button disabled={pending || disabled} size="lg" type="submit" variant={danger ? "danger" : "primary"}>
          {pending ? <Spinner /> : <PlayCircle aria-hidden className="size-4" />}
          {pending ? "جارٍ البدء..." : label}
        </Button>
      </form>
      {hint && state.status !== "error" && <p className="text-xs text-muted">{hint}</p>}
      {state.status === "error" && state.message && (
        <p className="flex items-center gap-1.5 text-xs font-semibold text-rose-600" role="alert">
          <TriangleAlert aria-hidden className="size-4" />
          {state.message}
        </p>
      )}
    </div>
  );
}
