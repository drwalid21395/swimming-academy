import { GraduationCap, LogIn, type LucideIcon } from "lucide-react";
import Link from "next/link";

import { ThemeToggle } from "@/components/theme-toggle";
import { getSiteBranding } from "@/lib/site-branding";
import { cn } from "@/lib/utils";

export type PublicCrumb = { label: string; href?: string };

export async function PublicShell({
  title,
  subtitle,
  icon: Icon,
  crumbs = [],
  children,
  aside,
}: {
  title: string;
  subtitle?: string;
  icon: LucideIcon;
  crumbs?: PublicCrumb[];
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  const branding = await getSiteBranding();

  return (
    <div className="min-h-screen pb-10">
      <div className="mx-auto w-full max-w-6xl p-4 lg:p-7">
        <header className="glass-panel mb-6 rounded-3xl p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-violet-soft text-white shadow-[0_12px_28px_-12px_rgba(100,141,255,0.9)]">
                <Icon aria-hidden className="size-6" />
              </span>
              <div className="min-w-0">
                <h1 className="text-xl font-extrabold tracking-tight sm:text-2xl">{title}</h1>
                {subtitle && <p className="mt-1.5 text-sm text-muted">{subtitle}</p>}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <ThemeToggle />
              <Link
                className="inline-flex items-center gap-2 rounded-2xl bg-brand-500 px-4 py-2.5 text-sm font-bold text-white shadow-[0_14px_30px_-16px_rgba(61,102,248,0.9)] transition hover:bg-brand-600"
                href="/sign-in"
              >
                <LogIn aria-hidden className="size-4" />
                دخول
              </Link>
            </div>
          </div>

          {crumbs.length > 0 && (
            <nav aria-label="مسار التصفح" className="mt-4 flex flex-wrap items-center gap-1.5 text-xs">
              <Link className="font-semibold text-brand-600 hover:underline dark:text-brand-300" href="/public">
                البوابة العامة
              </Link>
              {crumbs.map((crumb) => (
                <span className="flex items-center gap-1.5" key={crumb.label}>
                  <span aria-hidden className="text-slate-400">
                    /
                  </span>
                  {crumb.href ? (
                    <Link
                      className="font-semibold text-brand-600 hover:underline dark:text-brand-300"
                      href={crumb.href}
                    >
                      {crumb.label}
                    </Link>
                  ) : (
                    <span className="font-semibold text-[var(--app-text)]">{crumb.label}</span>
                  )}
                </span>
              ))}
            </nav>
          )}
        </header>

        <div className={cn("grid gap-6", aside && "lg:grid-cols-[1fr_20rem]")}>
          <div className="min-w-0 space-y-6">{children}</div>
          {aside}
        </div>

        <footer className="mt-8 flex flex-wrap items-center justify-between gap-2 rounded-3xl border border-[var(--glass-border)] bg-[var(--glass-bg)] px-5 py-4 text-xs text-muted backdrop-blur-xl">
          <span className="flex items-center gap-1.5">
            <GraduationCap aria-hidden className="size-4" />
            {branding.siteName} — بوابة عامة للطلاب والزوار
          </span>
          <span>الصفحة عامة ولا تتطلب تسجيل الدخول.</span>
        </footer>
      </div>
    </div>
  );
}
