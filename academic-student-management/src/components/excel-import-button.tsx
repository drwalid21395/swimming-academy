"use client";

import { FileUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, useRef, startTransition } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/loading";
import { Progress } from "@/components/ui/progress";
import {
  chunkRangeErrors,
  shiftChunkErrors,
  splitWorkbookForImport,
  type ImportChunkKind,
} from "@/lib/excel-chunks";
import { formatNumber } from "@/lib/format";
import type { ImportFeedback } from "@/lib/student-import";
import { cn } from "@/lib/utils";

const MAX_VISIBLE_ERRORS = 5;

/**
 * The button is shared by the student roster and the question bank, so the noun
 * is supplied by the caller instead of being hardcoded as "طالب".
 */
export type ImportNoun = { one: string; many: string };

export const STUDENT_NOUN: ImportNoun = { one: "طالب", many: "طلاب" };
export const QUESTION_NOUN: ImportNoun = { one: "سؤال", many: "أسئلة" };

/** Arabic counts 3-10 with the plural and everything else with the singular. */
function nounFor(noun: ImportNoun, count: number) {
  return count >= 3 && count <= 10 ? noun.many : noun.one;
}

type ImportProgress = {
  total: number;
  processed: number;
  created: number;
  updated: number;
  errors: { row: number; message: string }[];
};

export function ExcelImportButton<S extends ImportFeedback>({
  action,
  buttonLabel,
  hint,
  hiddenFields,
  kind = "students",
  noun = STUDENT_NOUN,
}: {
  action: (formData: FormData) => Promise<S>;
  buttonLabel: string;
  hint?: string;
  hiddenFields?: Record<string, string>;
  kind?: ImportChunkKind;
  noun?: ImportNoun;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startAction] = useTransition();
  const [result, setResult] = useState<S | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [stage, setStage] = useState<"reading" | "importing" | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);

  const handleFile = (file: File) => {
    setResult(null);
    setFatal(null);
    setProgress({ total: 0, processed: 0, created: 0, updated: 0, errors: [] });
    setStage("reading");

    startAction(async () => {
      let plan: Awaited<ReturnType<typeof splitWorkbookForImport>>;

      try {
        plan = await splitWorkbookForImport(file, kind);
      } catch (error) {
        setFatal(error instanceof Error ? error.message : "تعذر قراءة الملف.");
        setStage(null);
        return;
      }

      const { chunks, total, firstLines, rowCounts, sheetNames } = plan;
      setProgress({ total, processed: 0, created: 0, updated: 0, errors: [] });

      if (total === 0) {
        setStage(null);
        setResult({
          status: "error",
          message: "لا توجد صفوف بيانات لإدخالها.",
          errors: [],
        } as unknown as S);
        return;
      }

      setStage("importing");
      const totals: ImportProgress = { total, processed: 0, created: 0, updated: 0, errors: [] };
      let lastResult: S | null = null;
      let processed = 0;

      for (let index = 0; index < chunks.length; index += 1) {
        const formData = new FormData();
        if (hiddenFields) {
          for (const [name, value] of Object.entries(hiddenFields)) {
            formData.append(name, value);
          }
        }
        formData.append("file", chunks[index]);

        let chunkResult: S;
        try {
          chunkResult = await action(formData);
        } catch (error) {
          // A thrown error means the whole chunk failed: report every row in it.
          const message = error instanceof Error ? error.message : "خطأ غير معروف.";
          totals.errors.push(...chunkRangeErrors(firstLines[index], rowCounts[index], message));
          processed += rowCounts[index];
          totals.processed = processed;
          setProgress({ ...totals });
          continue;
        }

        const created = Number((chunkResult as { created?: number }).created ?? 0);
        const updated = Number((chunkResult as { updated?: number }).updated ?? 0);

        totals.created += created;
        totals.updated += updated;
        processed += rowCounts[index];
        totals.processed = processed;
        totals.errors.push(
            ...shiftChunkErrors(chunkResult.errors, firstLines[index], sheetNames[index]),
          );
        setProgress({ ...totals });
        lastResult = chunkResult;
      }

      setStage(null);

      // A row that updated an existing student counts as handled too.
      const added = totals.created + totals.updated;
      const skipped = totals.errors.length;
      const status: S["status"] = skipped === 0 ? "success" : added > 0 ? "partial" : "error";

      const summary =
        skipped === 0
          ? `${passive} إضافة ${formatNumber(added)} ${nounFor(noun, added)} بنجاح.`
          : `${passive} إضافة ${formatNumber(added)} ${nounFor(noun, added)}، ولم يُضف ${formatNumber(skipped)} ${nounFor(noun, skipped)}.`;

      setResult({
        ...(lastResult ?? { status: "error" as const, message: "", errors: [] }),
        status,
        message: summary,
        errors: totals.errors,
      } as unknown as S);

      if (status === "success" || status === "partial") router.refresh();
    });
  };

  const busy = pending || stage !== null;
  const percentage =
    progress && progress.total > 0
      ? Math.round((progress.processed / progress.total) * 100)
      : stage === "reading"
        ? 4
        : 0;
  const added = (progress?.created ?? 0) + (progress?.updated ?? 0);
  const passive = kind === "questions" ? "تمت" : "تم";
  const tone = stage === "importing" || stage === "reading" ? "blue" : statusTone(result?.status);

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-3">
        {hint && (
          <p className="text-xs text-muted" dir="rtl">
            {hint}
          </p>
        )}
        <Button
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          size="sm"
          type="button"
          variant="secondary"
        >
          {busy ? <Spinner /> : <FileUp aria-hidden className="size-4" />}
          {busy ? "جارٍ الاستيراد..." : buttonLabel}
        </Button>
        <input
          accept=".xlsx,.xls"
          className="hidden"
          data-testid="excel-file-input"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) handleFile(file);
            event.target.value = "";
          }}
          ref={inputRef}
          type="file"
        />
      </div>

      {progress && (
        <div className="w-full max-w-xl rounded-2xl bg-[var(--glass-bg-strong)] px-4 py-3 text-sm ring-1 ring-inset ring-[var(--glass-border)] backdrop-blur-xl">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="font-bold text-[var(--app-text)]">
              {stage === "reading"
                ? "جارٍ قراءة الملف..."
                : stage === "importing"
                  ? `جارٍ إضافة ${noun.many}: ${formatNumber(added)} من ${formatNumber(progress.total)}`
                  : `اكتمل: ${passive} إضافة ${formatNumber(added)} ${nounFor(noun, added)}`}
            </p>
            <p className="font-bold tabular-nums text-brand-700 dark:text-brand-300" dir="ltr">
              {formatNumber(percentage)}%
            </p>
          </div>

          <Progress tone={tone} value={percentage} />

          {progress.total > 0 && (
            <p className="mt-2 text-xs text-muted" dir="rtl">
              تمت معالجة {formatNumber(progress.processed)} من {formatNumber(progress.total)} صف
              {progress.errors.length > 0
                ? ` · ${formatNumber(progress.errors.length)} صف لم يتم إضافته`
                : ""}
            </p>
          )}
        </div>
      )}

      {fatal && (
        <div
          className="w-full max-w-xl rounded-2xl bg-rose-500/12 px-4 py-3 text-sm font-semibold text-rose-700 ring-1 ring-inset ring-rose-500/25 dark:text-rose-300"
          role="status"
        >
          {fatal}
        </div>
      )}

      {result && !fatal && (
        <div
          className={cn(
            "flex w-full max-w-xl flex-col gap-1.5 rounded-2xl px-4 py-3 text-sm font-semibold ring-1 ring-inset",
            result.status === "success" &&
              "bg-emerald-500/12 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300",
            result.status === "partial" &&
              "bg-amber-500/12 text-amber-700 ring-amber-500/25 dark:text-amber-300",
            result.status === "error" &&
              "bg-rose-500/12 text-rose-700 ring-rose-500/25 dark:text-rose-300",
          )}
          role="status"
        >
          <p>{result.message}</p>
          {result.errors.length > 0 && (
            <>
              <ul className="list-inside list-disc text-xs font-normal">
                {result.errors.slice(0, MAX_VISIBLE_ERRORS).map((error, index) => (
                  <li key={`${error.row}-${index}`}>{`صف ${error.row}: ${error.message}`}</li>
                ))}
              </ul>
              {result.errors.length > MAX_VISIBLE_ERRORS && (
                <p className="text-xs font-normal">
                  {`و${formatNumber(result.errors.length - MAX_VISIBLE_ERRORS)} خطأ آخر...`}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function statusTone(status: ImportFeedback["status"] | undefined) {
  if (status === "success") return "emerald" as const;
  if (status === "partial") return "amber" as const;
  if (status === "error") return "rose" as const;
  return "blue" as const;
}