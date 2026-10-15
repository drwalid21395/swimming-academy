"use client";

import { Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { difficultyLabels, questionTypeLabels } from "@/lib/labels";

import type { QuestionSubjectOption } from "./question-form-dialog";

const types = ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER", "ESSAY"] as const;
const difficulties = ["EASY", "MEDIUM", "HARD"] as const;

export function QuestionFilters({
  subjects,
  initial,
}: {
  subjects: QuestionSubjectOption[];
  initial: { query: string; subjectId: string; type: string; difficulty: string };
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

  const hasFilters = Boolean(
    initial.query || initial.subjectId || initial.type || initial.difficulty,
  );

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
            placeholder="نص السؤال أو الوحدة أو الفصل"
            type="search"
            value={query}
          />
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300" htmlFor="filterSubjectId">
          المادة
        </label>
        <Select
          defaultValue={initial.subjectId}
          id="filterSubjectId"
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
          <label className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300" htmlFor="filterType">
            النوع
          </label>
          <Select
            defaultValue={initial.type}
            id="filterType"
            name="type"
            onChange={(event) => apply({ type: event.target.value })}
          >
            <option value="">الكل</option>
            {types.map((item) => (
              <option key={item} value={item}>
                {questionTypeLabels[item]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300" htmlFor="filterDifficulty">
            الصعوبة
          </label>
          <Select
            defaultValue={initial.difficulty}
            id="filterDifficulty"
            name="difficulty"
            onChange={(event) => apply({ difficulty: event.target.value })}
          >
            <option value="">الكل</option>
            {difficulties.map((item) => (
              <option key={item} value={item}>
                {difficultyLabels[item]}
              </option>
            ))}
          </Select>
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
