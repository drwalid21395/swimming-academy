"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

export function ThemeToggle() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggleTheme() {
    const nextValue = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", nextValue);
    localStorage.setItem("theme", nextValue ? "dark" : "light");
    setIsDark(nextValue);
  }

  return (
    <button
      aria-label={isDark ? "التبديل إلى الوضع الفاتح" : "التبديل إلى الوضع الليلي"}
      className="rounded-2xl border border-slate-200/70 bg-white/70 p-2.5 text-slate-600 backdrop-blur-xl transition hover:bg-white hover:text-slate-900 dark:border-white/10 dark:bg-white/10 dark:text-white/80 dark:hover:bg-white/20"
      onClick={toggleTheme}
      type="button"
    >
      {isDark ? <Sun aria-hidden className="size-4" /> : <Moon aria-hidden className="size-4" />}
    </button>
  );
}
