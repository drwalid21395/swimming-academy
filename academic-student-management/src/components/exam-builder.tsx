"use client";

import { ClipboardList, Minus, Plus, RefreshCw, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/loading";
import { formatNumber } from "@/lib/format";
import type { PublicPracticeQuestion } from "@/lib/public-portal";

import { PracticeSession } from "./practice-session";

type TypeOption = { type: string; label: string; count: number };
type Mode = "all" | "types";

const TYPE_PARAM: Record<string, string> = {
  MULTIPLE_CHOICE: "mcq",
  TRUE_FALSE: "tf",
  SHORT_ANSWER: "short",
  ESSAY: "essay",
};

export function ExamBuilder({
  subjectId,
  options,
  total,
}: {
  subjectId: string;
  options: TypeOption[];
  total: number;
}) {
  const [mode, setMode] = useState<Mode>("all");
  const [allCount, setAllCount] = useState(10);
  const [typeCounts, setTypeCounts] = useState<Record<string, number>>(() =>
    Object.fromEntries(options.map((option) => [option.type, Math.min(option.count, 3)])),
  );
  const [phase, setPhase] = useState<"builder" | "loading" | "error">("builder");
  const [questions, setQuestions] = useState<PublicPracticeQuestion[]>([]);

  const availableOf = (type: string) => options.find((option) => option.type === type)?.count ?? 0;
  const maxAll = Math.max(1, Math.min(total, 50));
  const selectedTotal =
    mode === "all"
      ? allCount
      : options.reduce((sum, option) => sum + (typeCounts[option.type] ?? 0), 0);

  const buildUrl = () => {
    const base = `/api/public/build-exam?subjectId=${encodeURIComponent(subjectId)}&mode=${mode}`;
    if (mode === "all") return `${base}&total=${allCount}`;
    const counts = options
      .map((option) => `${TYPE_PARAM[option.type]}=${typeCounts[option.type] ?? 0}`)
      .join("&");
    return `${base}&${counts}`;
  };

  const start = async () => {
    setPhase("loading");
    try {
      const response = await fetch(buildUrl(), { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error((data as { error?: string }).error || "تعذر تحميل الأسئلة");
      setQuestions(Array.isArray(data.questions) ? data.questions : []);
    } catch {
      setPhase("error");
      return;
    }
    setPhase("builder");
  };

  if (phase === "loading") {
    return (
      <div className="flex items-center justify-center gap-3 py-12 text-muted">
        <Spinner />
        جارٍ تجهيز الامتحان...
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="space-y-4 py-6 text-center">
        <p className="flex items-center justify-center gap-2 text-sm font-semibold text-rose-700 dark:text-rose-300">
          <TriangleAlert aria-hidden className="size-5" />
          تعذر تجهيز الامتحان. حاول مرة أخرى.
        </p>
        <Button onClick={start} type="button" variant="secondary">
          <RefreshCw aria-hidden className="size-4" />
          إعادة المحاولة
        </Button>
      </div>
    );
  }

  if (questions.length > 0) {
    return (
      <PracticeSession
        doneLabel="إنشاء امتحان جديد"
        onDone={() => setQuestions([])}
        onExit={() => setQuestions([])}
        questions={questions}
      />
    );
  }

  if (total === 0) {
    return (
      <p className="py-4 text-center text-sm text-muted">
        بنك أسئلة هذه المادة فارغ، لا يمكن إنشاء امتحان تجريبي حالياً.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2">
        <button
          className={`rounded-2xl border px-4 py-3 text-sm font-bold transition ${
            mode === "all"
              ? "border-brand-500 bg-brand-500/12 text-brand-700 dark:text-brand-200"
              : "border-[var(--glass-border)] bg-[var(--glass-bg)] text-muted hover:bg-[var(--glass-bg-strong)]"
          }`}
          onClick={() => setMode("all")}
          type="button"
        >
          عشوائي من جميع الأنواع
        </button>
        <button
          className={`rounded-2xl border px-4 py-3 text-sm font-bold transition ${
            mode === "types"
              ? "border-brand-500 bg-brand-500/12 text-brand-700 dark:text-brand-200"
              : "border-[var(--glass-border)] bg-[var(--glass-bg)] text-muted hover:bg-[var(--glass-bg-strong)]"
          }`}
          onClick={() => setMode("types")}
          type="button"
        >
          تحديد عدد حسب النوع
        </button>
      </div>

      {mode === "all" ? (
        <div className="flex items-center justify-between gap-4 rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-4">
          <div>
            <p className="font-bold text-[var(--app-text)]">عدد الأسئلة</p>
            <p className="text-xs text-muted">من كل الأنواع معاً حتى {formatNumber(maxAll)} سؤال</p>
          </div>
          <CountStepper
            max={maxAll}
            min={1}
            onChange={setAllCount}
            value={allCount}
          />
        </div>
      ) : (
        <div className="space-y-2">
          {options.map((option) => {
            const available = availableOf(option.type);
            return (
              <div
                className="flex items-center justify-between gap-4 rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-4"
                key={option.type}
              >
                <div>
                  <p className="font-bold text-[var(--app-text)]">{option.label}</p>
                  <p className="text-xs text-muted">متاح: {formatNumber(available)}</p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge tone="blue">{formatNumber(typeCounts[option.type] ?? 0)}</Badge>
                  <CountStepper
                    max={available}
                    min={0}
                    onChange={(value) =>
                      setTypeCounts((current) => ({ ...current, [option.type]: value }))
                    }
                    value={typeCounts[option.type] ?? 0}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          إجمالي أسئلة الامتحان: <strong className="text-[var(--app-text)]">{formatNumber(selectedTotal)}</strong>
        </p>
        <Button disabled={selectedTotal === 0} onClick={start} type="button">
          <ClipboardList aria-hidden className="size-4" />
          ابدأ الامتحان
        </Button>
      </div>
    </div>
  );
}

function CountStepper({
  value,
  min,
  max,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <button
        aria-label="زيادة"
        className="grid size-9 place-items-center rounded-xl border border-[var(--glass-border)] text-[var(--app-text)] transition hover:bg-[var(--glass-bg-strong)] disabled:opacity-40"
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
        type="button"
      >
        <Plus aria-hidden className="size-4" />
      </button>
      <span className="grid w-10 place-items-center text-sm font-extrabold text-[var(--app-text)]">
        {formatNumber(value)}
      </span>
      <button
        aria-label="إنقاص"
        className="grid size-9 place-items-center rounded-xl border border-[var(--glass-border)] text-[var(--app-text)] transition hover:bg-[var(--glass-bg-strong)] disabled:opacity-40"
        disabled={value <= min}
        onClick={() => onChange(value - 1)}
        type="button"
      >
        <Minus aria-hidden className="size-4" />
      </button>
    </div>
  );
}