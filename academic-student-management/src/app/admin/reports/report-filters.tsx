"use client";

import { BarChart3, RotateCcw } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import type { ReportSubjectOption, ReportTermOption } from "@/lib/reports";

export function ReportFilters({
  terms,
  subjects,
  initial,
}: {
  terms: ReportTermOption[];
  subjects: ReportSubjectOption[];
  initial: { termId: string; subjectId: string };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [termId, setTermId] = useState(initial.termId);
  const [subjectId, setSubjectId] = useState(initial.subjectId);

  const apply = (next: { termId: string; subjectId: string }) => {
    const params = new URLSearchParams();
    if (next.termId) params.set("termId", next.termId);
    if (next.subjectId) params.set("subjectId", next.subjectId);
    const search = params.toString();
    router.push(search ? `${pathname}?${search}` : pathname);
  };

  return (
    <form
      className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
      onSubmit={(event) => {
        event.preventDefault();
        apply({ termId, subjectId });
      }}
    >
      <Field htmlFor="termId" label="الفصل الدراسي">
        <Select
          id="termId"
          name="termId"
          onChange={(event) => setTermId(event.target.value)}
          value={termId}
        >
          <option value="">كل الفصول</option>
          {terms.map((term) => (
            <option key={term.id} value={term.id}>
              {term.name}
              {term.isCurrent ? " (الحالي)" : ""}
            </option>
          ))}
        </Select>
      </Field>

      <Field htmlFor="subjectId" label="المادة">
        <Select
          id="subjectId"
          name="subjectId"
          onChange={(event) => setSubjectId(event.target.value)}
          value={subjectId}
        >
          <option value="">كل المواد</option>
          {subjects.map((subject) => (
            <option key={subject.id} value={subject.id}>
              {subject.name} ({subject.code})
            </option>
          ))}
        </Select>
      </Field>

      <div className="flex items-end gap-2">
        <Button type="submit">
          <BarChart3 aria-hidden className="size-4" />
          تطبيق
        </Button>
        <Button onClick={() => apply({ termId: "", subjectId: "" })} type="button" variant="ghost">
          <RotateCcw aria-hidden className="size-4" />
          إعادة تعيين
        </Button>
      </div>
    </form>
  );
}
