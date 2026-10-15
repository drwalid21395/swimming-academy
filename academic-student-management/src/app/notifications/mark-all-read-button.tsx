"use client";

import { CheckCheck } from "lucide-react";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/loading";

import { markAllReadAction } from "./actions";

const initialState = { status: "idle" as string, message: undefined as string | undefined };

export function MarkAllReadButton() {
  const [state, formAction, pending] = useActionState(markAllReadAction, initialState);

  return (
    <form action={formAction} className="flex items-center gap-2">
      <Button disabled={pending} size="sm" type="submit" variant="secondary">
        {pending ? <Spinner /> : <CheckCheck aria-hidden className="size-4" />}
        {pending ? "جارٍ التحديث..." : "تعليم الكل كمقروء"}
      </Button>
      {state.status === "success" && state.message && (
        <span className="text-xs font-semibold text-emerald-600">{state.message}</span>
      )}
    </form>
  );
}
