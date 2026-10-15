"use client";

import { KeyRound } from "lucide-react";
import { useActionState, useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Spinner } from "@/components/ui/loading";
import type { PasswordFormValues } from "@/lib/settings";

import { changePasswordAction, type SettingsActionState } from "./actions";

const initialState: SettingsActionState = { status: "idle" };

export function PasswordForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(changePasswordAction, initialState);

  useEffect(() => {
    if (state.status === "success") formRef.current?.reset();
  }, [state.status]);

  const errorFor = (field: keyof PasswordFormValues) => state.fieldErrors?.[field];

  return (
    <form action={formAction} className="max-w-md space-y-4" noValidate ref={formRef}>
      <Field error={errorFor("currentPassword")} htmlFor="currentPassword" label="كلمة المرور الحالية" required>
        <Input
          autoComplete="current-password"
          id="currentPassword"
          name="currentPassword"
          required
          type="password"
        />
      </Field>

      <Field
        error={errorFor("newPassword")}
        htmlFor="newPassword"
        hint="8 أحرف على الأقل"
        label="كلمة المرور الجديدة"
        required
      >
        <Input
          autoComplete="new-password"
          defaultValue={state.values?.newPassword ?? ""}
          id="newPassword"
          name="newPassword"
          required
          type="password"
        />
      </Field>

      <Field
        error={errorFor("confirmPassword")}
        htmlFor="confirmPassword"
        label="تأكيد كلمة المرور الجديدة"
        required
      >
        <Input
          autoComplete="new-password"
          defaultValue={state.values?.confirmPassword ?? ""}
          id="confirmPassword"
          name="confirmPassword"
          required
          type="password"
        />
      </Field>

      {state.status === "error" && state.message && (
        <p
          className="rounded-2xl bg-rose-500/12 px-4 py-3 text-sm font-semibold text-rose-700 ring-1 ring-inset ring-rose-500/25 dark:text-rose-300"
          role="alert"
        >
          {state.message}
        </p>
      )}

      {state.status === "success" && state.message && (
        <p
          className="rounded-2xl bg-emerald-500/12 px-4 py-3 text-sm font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-500/25 dark:text-emerald-300"
          role="status"
        >
          {state.message}
        </p>
      )}

      <Button disabled={pending} type="submit">
        {pending ? <Spinner /> : <KeyRound aria-hidden className="size-4" />}
        {pending ? "جارٍ التحديث..." : "تحديث كلمة المرور"}
      </Button>
    </form>
  );
}
