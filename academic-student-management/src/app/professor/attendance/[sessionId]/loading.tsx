/**
 * Shown while a professor's lecture sheet is being built.
 *
 * Keeps the tab painting during the navigation instead of leaving the previous
 * page frozen in place while the server aggregates the subject history.
 */
export default function Loading() {
  return (
    <div aria-busy className="space-y-4" aria-live="polite">
      <div className="h-20 animate-pulse rounded-2xl bg-[var(--glass-bg)]" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <div
            className="h-24 animate-pulse rounded-2xl bg-[var(--glass-bg)]"
            key={index}
          />
        ))}
      </div>
      <div className="h-12 animate-pulse rounded-2xl bg-[var(--glass-bg)]" />
      <div className="space-y-2">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((index) => (
          <div
            className="h-14 animate-pulse rounded-xl bg-[var(--glass-bg)]"
            key={index}
          />
        ))}
      </div>
      <p className="text-center text-sm text-muted">جارٍ تحميل سجل المحاضرة...</p>
    </div>
  );
}