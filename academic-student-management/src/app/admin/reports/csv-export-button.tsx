"use client";

import { Download } from "lucide-react";

import { downloadCsv } from "@/lib/csv";

export function CsvExportButton({ csv, fileName }: { csv: string; fileName: string }) {
  return (
    <button
      className="inline-flex items-center gap-2 rounded-xl border border-[var(--glass-border)] px-4 py-2 text-sm font-semibold transition hover:bg-[var(--glass-bg-strong)]"
      onClick={() => downloadCsv(fileName, csv)}
      type="button"
    >
      <Download aria-hidden className="size-4" />
      تصدير CSV
    </button>
  );
}
