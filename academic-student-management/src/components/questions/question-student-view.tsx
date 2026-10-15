"use client";

export type StudentViewOption = { id: string; text: string };

/**
 * The exact question card students see during an exam.
 * Used by the live attempt form (interactive) and by the admin/professor
 * question-bank preview (read-only) so both stay identical.
 */
export function QuestionStudentView({
  position,
  text,
  score,
  unit,
  options,
  fieldName,
  value,
  onAnswerChange,
}: {
  position: number;
  text: string;
  score: number;
  unit: string | null;
  options: StudentViewOption[];
  /** Provide both to make the card selectable, like the real exam. */
  fieldName?: string;
  value?: string;
  onAnswerChange?: (value: string) => void;
}) {
  const interactive = Boolean(fieldName && onAnswerChange);
  const answer = value ?? "";

  return (
    <section className="rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-4 backdrop-blur-xl sm:p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <h2 className="font-bold leading-7 text-[var(--app-text)]">
          <span className="me-2 text-brand-600 dark:text-brand-300">{position}.</span>
          {text}
        </h2>
        <span className="shrink-0 rounded-lg bg-slate-500/10 px-2.5 py-1 text-xs font-bold text-slate-600 dark:text-slate-300">
          {score} درجة
        </span>
      </div>

      {unit && <p className="mb-3 text-xs text-muted">{unit}</p>}

      {options.length > 0 ? (
        <div className="space-y-2">
          {options.map((option) => (
            <label
              className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition ${
                interactive ? "cursor-pointer" : ""
              } ${
                answer === option.text
                  ? "border-brand-500 bg-brand-500/8 font-semibold text-[var(--app-text)]"
                  : "border-[var(--glass-border)] text-muted hover:bg-[var(--glass-bg-strong)]"
              }`}
              key={option.id}
            >
              {interactive ? (
                <input
                  checked={answer === option.text}
                  className="size-4 accent-brand-600"
                  name={fieldName}
                  onChange={() => onAnswerChange?.(option.text)}
                  type="radio"
                  value={option.text}
                />
              ) : (
                <span className="size-4 shrink-0 rounded-full border-2 border-slate-400/70" />
              )}
              <span>{option.text}</span>
            </label>
          ))}
        </div>
      ) : interactive ? (
        <textarea
          className="min-h-32 w-full rounded-2xl border border-[var(--glass-border)] bg-[var(--field-bg)] px-4 py-3 text-sm leading-7 text-[var(--app-text)] backdrop-blur-xl focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/15"
          name={fieldName}
          onChange={(event) => onAnswerChange?.(event.target.value)}
          placeholder="اكتب إجابتك هنا..."
          value={answer}
        />
      ) : (
        <div className="min-h-32 w-full rounded-2xl border border-[var(--glass-border)] bg-[var(--field-bg)] px-4 py-3 text-sm leading-7 text-muted">
          اكتب إجابتك هنا...
        </div>
      )}
    </section>
  );
}
