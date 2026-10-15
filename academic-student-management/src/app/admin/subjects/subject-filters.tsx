"use client";

import { Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";

export type SubjectDepartmentOption = { id: string; name: string; code: string };
export type SubjectTermOption = { id: string; name: string; isCurrent: boolean };

export function SubjectFilters({
  departments,
  terms,
  initial,
}: {
  departments: SubjectDepartmentOption[];
  terms: SubjectTermOption[];
  initial: { query: string; departmentId: string; academicTermId: string };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(initial.query);

  const apply = (updates: Record<string, string>) => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("page");
    params.delete("enrollQuery");

    for (const [key, value] of Object.entries(updates)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }

    const search = params.toString();
    router.push(search ? `${pathname}?${search}` : pathname);
  };

  const hasFilters = Boolean(initial.query || initial.departmentId || initial.academicTermId);

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
            placeholder="اسم المادة أو كودها"
            type="search"
            value={query}
          />
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300" htmlFor="departmentId">
          القسم
        </label>
        <Select
          defaultValue={initial.departmentId}
          id="departmentId"
          name="departmentId"
          onChange={(event) => apply({ departmentId: event.target.value })}
        >
          <option value="">كل الأقسام</option>
          {departments.map((department) => (
            <option key={department.id} value={department.id}>
              {department.name}
            </option>
          ))}
        </Select>
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300" htmlFor="academicTermId">
          الفصل الدراسي
        </label>
        <Select
          defaultValue={initial.academicTermId}
          id="academicTermId"
          name="academicTermId"
          onChange={(event) => apply({ academicTermId: event.target.value })}
        >
          <option value="">كل الفصول</option>
          {terms.map((term) => (
            <option key={term.id} value={term.id}>
              {term.name}
              {term.isCurrent ? " (الحالي)" : ""}
            </option>
          ))}
        </Select>
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
