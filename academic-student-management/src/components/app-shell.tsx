import type { LucideIcon } from "lucide-react";
import { getServerSession } from "next-auth";
import Link from "next/link";

import { authOptions } from "@/auth";
import { BrandLogo } from "@/components/brand-logo";
import { LogoutButton } from "@/components/logout-button";
import { NotificationsBell } from "@/components/notifications-bell";
import { PublicSiteButton } from "@/components/public-site-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { getSiteBranding } from "@/lib/site-branding";
import { cn } from "@/lib/utils";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  disabled?: boolean;
};

export async function AppShell({
  userName,
  roleLabel,
  navItems,
  title,
  subtitle,
  children,
}: {
  userName: string;
  roleLabel: string;
  navItems: NavItem[];
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  const [session, branding] = await Promise.all([
    getServerSession(authOptions),
    getSiteBranding(),
  ]);
  const canEditBrand = session?.user?.role === "ADMIN";

  return (
    <div className="min-h-screen">
      <div className="mx-auto flex w-full max-w-[1480px] gap-6 p-4 lg:p-7">
        <aside
          className="sticky top-7 hidden h-[calc(100vh-3.5rem)] w-68 shrink-0 flex-col overflow-hidden rounded-3xl p-4 text-white shadow-[0_30px_70px_-40px_rgba(9,14,40,0.9)] lg:flex"
          style={{ background: "var(--sidebar-background)" }}
        >
          <div
            aria-hidden
            className="pointer-events-none absolute -left-16 top-10 size-56 rounded-full bg-brand-500/25 blur-3xl"
          />

          <div className="relative mb-6 flex items-center gap-3 px-2 pt-2">
            <BrandLogo
              canEdit={canEditBrand}
              siteLogo={branding.siteLogo}
              siteName={branding.siteName}
            />
            <div className="min-w-0">
              <p className="line-clamp-2 text-sm font-bold leading-5" title={branding.siteName}>
                {branding.siteName}
              </p>
              <p className="text-xs" style={{ color: "var(--sidebar-muted)" }}>
                نظام إدارة الطلاب
              </p>
            </div>
          </div>

          <nav className="relative flex flex-1 flex-col gap-1.5">
            {navItems.map((item) => {
              const content = (
                <>
                  <item.icon aria-hidden className="size-5 shrink-0" />
                  <span className="flex-1 text-right">{item.label}</span>
                  {item.disabled && (
                    <span className="rounded-md bg-white/10 px-2 py-0.5 text-[10px] text-white/60">
                      قريباً
                    </span>
                  )}
                </>
              );

              if (item.disabled) {
                return (
                  <span
                    className="flex cursor-not-allowed items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium text-white/35"
                    key={item.href}
                  >
                    {content}
                  </span>
                );
              }

              return (
                <Link
                  className="group relative flex items-center gap-3 overflow-hidden rounded-2xl px-3 py-2.5 text-sm font-semibold text-white/80 transition-all duration-200 hover:bg-white/10 hover:text-white"
                  href={item.href}
                  key={item.href}
                  prefetch={false}
                >
                  <span className="absolute inset-y-2 right-0 w-1 rounded-full bg-gradient-to-b from-brand-300 to-accent-400 opacity-0 transition-opacity group-hover:opacity-100" />
                  {content}
                </Link>
              );
            })}
          </nav>

          <div
            className="relative mt-4 rounded-2xl border border-white/10 bg-white/5 p-3 backdrop-blur-xl"
            style={{ color: "var(--sidebar-text)" }}
          >
            <p className="text-sm font-bold text-white">{userName}</p>
            <p className="text-xs" style={{ color: "var(--sidebar-muted)" }}>
              {roleLabel}
            </p>
            <div className="mt-3 flex items-center gap-2 [&_button]:border-white/10 [&_button]:bg-white/10 [&_button]:text-white/80 [&_button:hover]:bg-white/20">
              <LogoutButton />
              <ThemeToggle />
            </div>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <header className="glass-panel mb-6 rounded-3xl p-5 sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h1 className="truncate text-xl font-extrabold tracking-tight sm:text-2xl">{title}</h1>
                <p className="mt-1.5 text-sm text-muted">{subtitle}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <PublicSiteButton />
                <NotificationsBell />
                <span className="lg:hidden">
                  <ThemeToggle />
                </span>
              </div>
            </div>

            <nav className="mt-4 flex gap-2 overflow-x-auto pb-1 lg:hidden">
              {navItems
                .filter((item) => !item.disabled)
                .map((item) => (
                  <Link
                    className="shrink-0 rounded-2xl border border-white/60 bg-white/70 px-3.5 py-2 text-sm font-semibold text-slate-700 backdrop-blur-xl transition hover:bg-white dark:border-white/10 dark:bg-white/5 dark:text-slate-200"
                    href={item.href}
                    key={item.href}
                    prefetch={false}
                  >
                    {item.label}
                  </Link>
                ))}
            </nav>
          </header>

          <main className="space-y-6 pb-10">{children}</main>
        </div>
      </div>
    </div>
  );
}
