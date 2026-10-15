"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import type { PublicSubject } from "@/lib/public-portal";

export function SubjectSearch({ subjects }: { subjects: PublicSubject[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");

  const normalized = query.trim().toLowerCase();
  const matches = normalized
    ? subjects
        .filter(
          (subject) =>
            subject.name.toLowerCase().includes(normalized) ||
            subject.code.toLowerCase().includes(normalized) ||
            subject.department.name.toLowerCase().includes(normalized),
        )
        .slice(0, 8)
    : subjects.slice(0, 8);

  const go = (id: string) => {
    setQuery("");
    router.push(`/public/subject/${id}`);
  };

  return (
    <div>
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          if (matches[0]) go(matches[0].id);
        }}
      >
        <div className="relative flex-1">
          <Search
            aria-hidden
            className="pointer-events-none absolute right-4 top-1/2 size-4 -translate-y-1/2 text-slate-400"
          />
          <Input
            aria-label="ابحث عن مادة"
            className="pr-11"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="ابحث باسم المادة أو الكود أو القسم..."
            value={query}
          />
        </div>
        <Button disabled={matches.length === 0} type="submit">
          فتح
        </Button>
      </form>

      <ul className="mt-3 divide-y divide-[var(--glass-border)]">
        {matches.length === 0 ? (
          <li className="py-3 text-sm text-muted">لا توجد مادة مطابقة للبحث.</li>
        ) : (
          matches.map((subject) => (
            <li key={subject.id}>
              <button
                className="flex w-full items-center justify-between gap-3 py-3 text-right transition hover:text-brand-600 dark:hover:text-brand-300"
                onClick={() => go(subject.id)}
                type="button"
              >
                <span className="min-w-0">
                  <span className="block font-semibold text-[var(--app-text)]">{subject.name}</span>
                  <span className="block text-xs text-muted">
                    {subject.code} — {subject.department.name}
                  </span>
                </span>
                <span className="shrink-0 text-xs font-semibold text-brand-600 dark:text-brand-300">
                  عرض
                </span>
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
