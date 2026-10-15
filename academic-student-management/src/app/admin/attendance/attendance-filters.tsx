"use client";

import { Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import type { SessionOption } from "@/lib/attendance";

export function AttendanceFilters({
  subjects,
  initial,
}: {
  subjects: SessionOption[];
  initial: { query: string; subjectId: string; from: string; to: string };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(initial.query);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);

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

  const hasFilters = Boolean(
    initial.query || initial.subjectId || initial.from || initial.to,
  );

  return (
    <form
      className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
      onSubmit={(event) => {
        event.preventDefault();
        apply({ query, from, to });
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
            placeholder="عنوان المحاضرة أو اسم المادة"
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

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300" htmlFor="from">
            من تاريخ
          </label>
          <Input
            id="from"
            name="from"
            onChange={(event) => setFrom(event.target.value)}
            type="date"
            value={from}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300" htmlFor="to">
            إلى تاريخ
          </label>
          <Input
            id="to"
            name="to"
            onChange={(event) => setTo(event.target.value)}
            type="date"
            value={to}
          />
        </div>
      </div>

      <div className="flex items-end gap-2 sm:col-span-2 xl:col-span-4">
        <Button size="sm" type="submit">
          <Search aria-hidden className="size-4" />
          تطبيق البحث
        </Button>
        {hasFilters && (
          <Button
            onClick={() => {
              setQuery("");
              setFrom("");
              setTo("");
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
