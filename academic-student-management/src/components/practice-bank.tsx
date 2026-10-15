"use client";

import { RefreshCw, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/loading";
import type { PublicPracticeQuestion } from "@/lib/public-portal";

import { PracticeSession } from "./practice-session";

export function PracticeBank({ subjectId }: { subjectId: string }) {
  const [questions, setQuestions] = useState<PublicPracticeQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/public/practice-questions?subjectId=${encodeURIComponent(subjectId)}&take=10`,
        { cache: "no-store" },
      );
      const data = await response.json();
      if (!response.ok) throw new Error((data as { error?: string }).error || "تعذر تحميل الأسئلة");
      setQuestions(Array.isArray(data.questions) ? data.questions : []);
    } catch {
      setError("تعذر تحميل أسئلة الممارسة. حاول مرة أخرى.");
    } finally {
      setLoading(false);
    }
  }, [subjectId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-3 py-12 text-muted">
        <Spinner />
        جارٍ تحميل أسئلة الممارسة...
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4 py-6 text-center">
        <p className="flex items-center justify-center gap-2 text-sm font-semibold text-rose-700 dark:text-rose-300">
          <TriangleAlert aria-hidden className="size-5" />
          {error}
        </p>
        <Button onClick={load} type="button" variant="secondary">
          <RefreshCw aria-hidden className="size-4" />
          إعادة المحاولة
        </Button>
      </div>
    );
  }

  if (questions.length === 0) {
    return (
      <div className="py-6 text-center">
        <p className="text-sm text-muted">لا توجد أسئلة في بنك هذه المادة للممارسة بعد.</p>
      </div>
    );
  }

  return (
    <PracticeSession
      doneLabel="تجربة أسئلة أخرى"
      onDone={load}
      questions={questions}
    />
  );
}