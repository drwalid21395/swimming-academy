"use client";

import { Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import type { AnnouncementSubjectOption } from "@/lib/announcements";

export function AnnouncementFilters({
  subjects,
  initial,
}: {
  subjects: AnnouncementSubjectOption[];
  initial: { query: string; subjectId: string };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(initial.query);

  const apply = (updates: Record<string, string>) => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("page");

    for (const [key, value] of Object.entries(updates)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }

    const search = params.toString();
    router.push(search ? `${pathname}?${search}` : pathname);
  };

  const hasFilters = Boolean(initial.query || initial.subjectId);

  return (
    <form
      className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
      onSubmit={(event) => {
        event.preventDefault();
        apply({ query });
      }}
    >
      <div className="xl:col-span-2">
        <label className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300" htmlFor="query">
          بحث
        </label>
        <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
          />
          <Input
            className="pr-9"
            id="query"
            name="query"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="عنوان الإعلان أو محتواه"
            type="search"
            value={query}
          />
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300" htmlFor="subjectId">
          المادة
        </label>
        <Select
          defaultValue={initial.subjectId}
          id="subjectId"
          name="subjectId"
          onChange={(event) => apply({ subjectId: event.target.value })}
        >
          <option value="">كل المواد</option>
          {subjects.map((subject) => (
            <option key={subject.id} value={subject.id}>
              {subject.name} ({subject.code})
            </option>
          ))}
        </Select>
      </div>

      <div className="flex items-end gap-2">
        <Button size="sm" type="submit">
          <Search aria-hidden className="size-4" />
          تطبيق البحث
        </Button>
        {hasFilters && (
          <Button
            onClick={() => {
              setQuery("");
              router.push(pathname);
            }}
            size="sm"
            type="button"
            variant="secondary"
          >
            <X aria-hidden className="size-4" />
            إزالة الفلاتر
          </Button>
        )}
      </div>
    </form>
  );
}
