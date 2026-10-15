"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

export function NotificationsBell() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const response = await fetch("/api/notifications/unread", { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as { count?: number };
        if (active) setCount(data.count ?? 0);
      } catch {
        if (active) setCount(null);
      }
    };

    void load();
    const timer = window.setInterval(load, 30000);

    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);

    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  return (
    <Link
      aria-label="الإشعارات"
      className="relative grid size-10 place-items-center rounded-xl border border-[var(--glass-border)] bg-[var(--field-bg)] text-slate-600 transition hover:bg-[var(--glass-bg-strong)] dark:text-slate-200"
      href="/notifications"
      title="الإشعارات"
    >
      <Bell aria-hidden className="size-5" />
      {count !== null && count > 0 && (
        <span className="absolute -left-1 -top-1 grid min-w-5 place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
