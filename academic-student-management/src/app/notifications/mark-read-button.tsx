"use client";

import { Check } from "lucide-react";
import { useActionState } from "react";

import { Spinner } from "@/components/ui/loading";

import { markReadAction } from "./actions";

const initialState = { status: "idle" as string, message: undefined as string | undefined };

export function MarkReadButton({ notificationId }: { notificationId: string }) {
  const [state, formAction, pending] = useActionState(markReadAction, initialState);

  return (
    <form action={formAction}>
      <input name="notificationId" type="hidden" value={notificationId} />
      <button
        className="rounded-lg p-2 text-brand-600 transition hover:bg-brand-500/10 disabled:opacity-50 dark:text-brand-300"
        disabled={pending}
        title="تعليم كمقروء"
        type="submit"
      >
        {pending ? <Spinner /> : <Check aria-hidden className="size-4" />}
      </button>
      {state.status === "error" && state.message && (
        <span className="text-xs text-rose-600" role="alert">
          {state.message}
        </span>
      )}
    </form>
  );
}
