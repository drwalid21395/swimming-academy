"use client";

import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";

import { TH } from "@/components/ui/table";
import { cn } from "@/lib/utils";

const triggerClasses =
  "flex items-center gap-1.5 px-4 py-3.5 transition-colors hover:text-brand-700 dark:hover:text-brand-300";

function SortIcon({ active, dir }: { active: boolean; dir: "asc" | "desc" }) {
  const Icon = !active ? ChevronsUpDown : dir === "asc" ? ArrowUp : ArrowDown;

  return (
    <Icon
      aria-hidden
      className={cn(
        "size-3.5 shrink-0 opacity-60",
        active ? "opacity-100" : "text-slate-400 dark:text-slate-500",
      )}
    />
  );
}

/**
 * `aria-sort` belongs on the header cell itself, not on the link inside it, so
 * assistive technology announces the column state.
 */
function ariaSort(active: boolean, dir: "asc" | "desc") {
  return active ? (dir === "asc" ? "ascending" : "descending") : "none";
}

/** URL-driven sorting: clicking navigates, so the sort survives a refresh. */
export function SortableTH({
  active = false,
  dir = "asc",
  href,
  children,
}: {
  active?: boolean;
  dir?: "asc" | "desc";
  href: string;
  children: React.ReactNode;
}) {
  return (
    <TH aria-sort={ariaSort(active, dir)} className="p-0">
      <a className={cn(triggerClasses, active && "text-brand-700 dark:text-brand-300")} href={href} title="اضغط للترتيب تصاعدي أو تنازلي">
        <span>{children}</span>
        <SortIcon active={active} dir={dir} />
      </a>
    </TH>
  );
}

/**
 * In-memory sorting: clicking only changes local state. Required wherever the
 * table holds unsaved drafts, because a navigation would discard them.
 */
export function SortableTHButton({
  active = false,
  dir = "asc",
  onClick,
  children,
  className,
}: {
  active?: boolean;
  dir?: "asc" | "desc";
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <TH aria-sort={ariaSort(active, dir)} className="p-0">
      <button
        className={cn(triggerClasses, active && "text-brand-700 dark:text-brand-300", className)}
        onClick={onClick}
        title="اضغط للترتيب تصاعدي أو تنازلي"
        type="button"
      >
        <span>{children}</span>
        <SortIcon active={active} dir={dir} />
      </button>
    </TH>
  );
}