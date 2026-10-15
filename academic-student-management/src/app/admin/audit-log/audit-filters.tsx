"use client";

import { Filter, RotateCcw, Search } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { AUDIT_PAGE_SIZES, type AuditLogFilters, type AuditOption } from "@/lib/audit-log";

export function AuditFilters({
  actions,
  entities,
  users,
  initial,
}: {
  actions: AuditOption[];
  entities: AuditOption[];
  users: AuditOption[];
  initial: AuditLogFilters;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const [action, setAction] = useState(initial.action);
  const [entity, setEntity] = useState(initial.entity);
  const [userId, setUserId] = useState(initial.userId);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [q, setQ] = useState(initial.q);
  const [pageSize, setPageSize] = useState(String(initial.pageSize));

  const apply = (next: {
    action: string;
    entity: string;
    userId: string;
    from: string;
    to: string;
    q: string;
    pageSize: string;
  }) => {
    const params = new URLSearchParams();
    if (next.action) params.set("action", next.action);
    if (next.entity) params.set("entity", next.entity);
    if (next.userId) params.set("userId", next.userId);
    if (next.from) params.set("from", next.from);
    if (next.to) params.set("to", next.to);
    if (next.q) params.set("q", next.q);
    if (next.pageSize !== "25") params.set("pageSize", next.pageSize);
    const search = params.toString();
    router.push(search ? `${pathname}?${search}` : pathname);
  };

  const current = { action, entity, userId, from, to, q, pageSize };

  return (
    <form
      className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
      onSubmit={(event) => {
        event.preventDefault();
        apply(current);
      }}
    >
      <Field htmlFor="action" label="الإجراء">
        <Select id="action" onChange={(event) => setAction(event.target.value)} value={action}>
          <option value="">كل الإجراءات</option>
          {actions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field htmlFor="entity" label="نوع العنصر">
        <Select id="entity" onChange={(event) => setEntity(event.target.value)} value={entity}>
          <option value="">كل العناصر</option>
          {entities.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field htmlFor="userId" label="المنفّذ">
        <Select id="userId" onChange={(event) => setUserId(event.target.value)} value={userId}>
          <option value="">كل المستخدمين</option>
          {users.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field htmlFor="q" label="بحث">
        <Input
          id="q"
          onChange={(event) => setQ(event.target.value)}
          placeholder="معرّف، بريد، IP..."
          value={q}
        />
      </Field>

      <Field htmlFor="from" label="من تاريخ">
        <Input id="from" onChange={(event) => setFrom(event.target.value)} type="date" value={from} />
      </Field>

      <Field htmlFor="to" label="إلى تاريخ">
        <Input id="to" onChange={(event) => setTo(event.target.value)} type="date" value={to} />
      </Field>

      <Field htmlFor="pageSize" label="عدد الصفوف">
        <Select id="pageSize" onChange={(event) => setPageSize(event.target.value)} value={pageSize}>
          {AUDIT_PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </Select>
      </Field>

      <div className="flex items-end gap-2">
        <Button type="submit">
          <Filter aria-hidden className="size-4" />
          تصفية
        </Button>
        <Button
          onClick={() => {
            setAction("");
            setEntity("");
            setUserId("");
            setFrom("");
            setTo("");
            setQ("");
            setPageSize("25");
            apply({ action: "", entity: "", userId: "", from: "", to: "", q: "", pageSize: "25" });
          }}
          type="button"
          variant="ghost"
        >
          <RotateCcw aria-hidden className="size-4" />
          إعادة تعيين
        </Button>
      </div>

      <p className="flex items-center gap-1.5 text-xs text-muted sm:col-span-2 xl:col-span-4">
        <Search aria-hidden className="size-3.5" />
        البحث يشمل الإجراء، العنصر، المعرّف، البريد، الاسم، وعنوان IP.
      </p>
    </form>
  );
}
