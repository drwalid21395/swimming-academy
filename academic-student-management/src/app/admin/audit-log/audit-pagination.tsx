"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";
import type { AuditLogFilters } from "@/lib/audit-log";

export function AuditPagination({
  filters,
  page,
  pageCount,
  total,
  pageSize,
}: {
  filters: AuditLogFilters;
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const goTo = (nextPage: number) => {
    const params = new URLSearchParams();
    if (filters.action) params.set("action", filters.action);
    if (filters.entity) params.set("entity", filters.entity);
    if (filters.userId) params.set("userId", filters.userId);
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    if (filters.q) params.set("q", filters.q);
    if (pageSize !== 25) params.set("pageSize", String(pageSize));
    if (nextPage > 1) params.set("page", String(nextPage));
    const search = params.toString();
    router.push(search ? `${pathname}?${search}` : pathname);
  };

  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-2 text-sm">
      <p className="text-muted">
        عرض <span className="font-semibold text-[var(--app-text)]">{formatNumber(first)}</span>–
        <span className="font-semibold text-[var(--app-text)]">{formatNumber(last)}</span> من{" "}
        <span className="font-semibold text-[var(--app-text)]">{formatNumber(total)}</span> عملية
      </p>

      <div className="flex items-center gap-2">
        <Button disabled={page <= 1} onClick={() => goTo(page - 1)} size="sm" variant="secondary">
          <ChevronRight aria-hidden className="size-4" />
          السابق
        </Button>
        <span className="text-xs font-semibold text-muted">
          صفحة {formatNumber(page)} من {formatNumber(pageCount)}
        </span>
        <Button
          disabled={page >= pageCount}
          onClick={() => goTo(page + 1)}
          size="sm"
          variant="secondary"
        >
          التالي
          <ChevronLeft aria-hidden className="size-4" />
        </Button>
      </div>
    </div>
  );
}
