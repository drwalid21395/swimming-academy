"use client";

import { Library, RefreshCw, TriangleAlert } from "lucide-react";
import { useCallback, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/loading";
import { formatNumber } from "@/lib/format";
import type { PublicPracticeQuestion } from "@/lib/public-portal";

import { PracticeSession } from "./practice-session";

export function BankByType({
  subjectId,
  options,
  total,
}: {
  subjectId: string;
  options: { type: string; label: string; count: number }[];
  total: number;
}) {
  const [phase, setPhase] = useState<"select" | "loading" | "error">("select");
  const [questions, setQuestions] = useState<PublicPracticeQuestion[]>([]);
  const [mode, setMode] = useState<string>("");

  const start = useCallback(async (mode: string, type: string | null) => {
    setPhase("loading");
    setMode(mode);
    try {
      const url = type
        ? `/api/public/bank-questions?subjectId=${encodeURIComponent(subjectId)}&type=${encodeURIComponent(type)}`
        : `/api/public/practice-questions?subjectId=${encodeURIComponent(subjectId)}&take=10`;
      const response = await fetch(url, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error((data as { error?: string }).error || "تعذر تحميل الأسئلة");
      setQuestions(Array.isArray(data.questions) ? data.questions : []);
      setPhase("select");
    } catch {
      setMode("");
      setPhase("error");
    }
  }, [subjectId]);

  if (phase === "loading") {
    return (
      <div className="flex items-center justify-center gap-3 py-12 text-muted">
        <Spinner />
        جارٍ تحميل الأسئلة...
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="space-y-4 py-6 text-center">
        <p className="flex items-center justify-center gap-2 text-sm font-semibold text-rose-700 dark:text-rose-300">
          <TriangleAlert aria-hidden className="size-5" />
          تعذر تحميل الأسئلة. حاول مرة أخرى.
        </p>
        <Button
          onClick={() => start(mode, mode === "all" ? null : mode)}
          type="button"
          variant="secondary"
        >
          <RefreshCw aria-hidden className="size-4" />
          إعادة المحاولة
        </Button>
      </div>
    );
  }

  if (questions.length > 0) {
    return (
      <PracticeSession
        doneLabel="اختيار نوع آخر"
        onDone={() => {
          setQuestions([]);
        }}
        onExit={() => {
          setQuestions([]);
        }}
        questions={questions}
      />
    );
  }

  return (
    <div>
      <p className="mb-3 text-sm text-muted">
        اختر نوع السؤال ليتم فتح جميع أسئلته واحدة تلو الأخرى مع عرض الإجابة النموذجية، أو ابدأ بأسئلة
        عشوائية من جميع الأنواع.
      </p>

      {total === 0 ? (
        <p className="py-4 text-center text-sm text-muted">بنك أسئلة هذه المادة فارغ حالياً.</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          <button
            className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-4 text-start transition hover:border-brand-500/50 hover:bg-[var(--glass-bg-strong)]"
            onClick={() => start("all", null)}
            type="button"
          >
            <span className="flex items-center gap-2.5 font-bold text-[var(--app-text)]">
              <Library aria-hidden className="size-4 text-brand-600 dark:text-brand-300" />
              أسئلة عشوائية (جميع الأنواع)
            </span>
            <Badge tone="neutral">{formatNumber(total)}</Badge>
          </button>

          {options.map((option) => (
            <button
              className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-4 text-start transition hover:border-brand-500/50 hover:bg-[var(--glass-bg-strong)]"
              key={option.type}
              onClick={() => start(option.type, option.type)}
              type="button"
            >
              <span className="font-bold text-[var(--app-text)]">{option.label}</span>
              <Badge tone="blue">{formatNumber(option.count)}</Badge>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}