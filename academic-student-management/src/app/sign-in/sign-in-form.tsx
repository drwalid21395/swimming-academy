"use client";

import { ArrowLeft, Loader2 } from "lucide-react";
import { signIn } from "next-auth/react";
import { useActionState } from "react";

type SignInState = { error?: string };

const initialState: SignInState = {};

export function SignInForm() {
  const [state, formAction, pending] = useActionState(async (_: SignInState, formData: FormData) => {
    const result = await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirect: false,
    });

    if (result?.error) return { error: "بيانات الدخول غير صحيحة أو الحساب غير نشط." };
    window.location.assign("/");
    return {};
  }, initialState);

  return (
    <form action={formAction} className="mt-7 space-y-5" noValidate>
      <label className="block text-sm font-bold" htmlFor="email">
        البريد الإلكتروني
        <input
          autoComplete="email"
          className="mt-2 h-12 w-full rounded-2xl border border-[var(--glass-border)] bg-[var(--field-bg)] px-4 text-left backdrop-blur-xl transition focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/15"
          dir="ltr"
          id="email"
          name="email"
          placeholder="name@university.edu"
          required
          type="email"
        />
      </label>

      <label className="block text-sm font-bold" htmlFor="password">
        كلمة المرور
        <input
          autoComplete="current-password"
          className="mt-2 h-12 w-full rounded-2xl border border-[var(--glass-border)] bg-[var(--field-bg)] px-4 text-left backdrop-blur-xl transition focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/15"
          dir="ltr"
          id="password"
          name="password"
          required
          type="password"
        />
      </label>

      {state.error && (
        <p
          className="rounded-2xl bg-rose-500/12 px-4 py-3 text-sm font-semibold text-rose-700 ring-1 ring-inset ring-rose-500/25"
          role="alert"
        >
          {state.error}
        </p>
      )}

      <button
        className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-l from-brand-600 to-brand-500 font-bold text-white shadow-[0_16px_34px_-18px_rgba(36,69,234,0.95)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? (
          <>
            <Loader2 aria-hidden className="size-4 animate-spin" />
            جارٍ تسجيل الدخول...
          </>
        ) : (
          <>
            تسجيل الدخول
            <ArrowLeft aria-hidden className="size-4" />
          </>
        )}
      </button>
    </form>
  );
}
