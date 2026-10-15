import { ShieldAlert } from "lucide-react";
import Link from "next/link";

import { ButtonLink } from "@/components/ui/button";

export default function UnauthorizedPage() {
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <section className="glass-panel-strong w-full max-w-lg rounded-3xl p-9 text-center">
        <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-rose-500/12 text-rose-600 dark:text-rose-300">
          <ShieldAlert aria-hidden className="size-7" />
        </span>
        <h1 className="mt-5 text-2xl font-extrabold tracking-tight">لا تملك صلاحية الوصول</h1>
        <p className="mt-3 leading-7 text-muted">هذه الصفحة متاحة لدور وظيفي مختلف.</p>
        <ButtonLink className="mt-7" href="/">
          العودة للصفحة الرئيسية
        </ButtonLink>
        <p className="mt-4 text-xs text-muted">
          أو <Link className="font-bold text-brand-600 hover:underline" href="/sign-in">سجّل الدخول بحساب آخر</Link>
        </p>
      </section>
    </main>
  );
}
