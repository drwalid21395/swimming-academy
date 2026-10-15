/**
 * Shown while a lecture sheet is being built.
 *
 * Without this file the navigation kept the previous page on screen and waited for
 * the server, which is what the browser reported as an unresponsive tab: the click
 * looked dead. Next streams this in immediately, so there is always something
 * painting while the roster and the history aggregate are queried.
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