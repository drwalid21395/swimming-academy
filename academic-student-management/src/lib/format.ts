const locale = "ar-EG";

/**
 * Formatters are built once and reused.
 *
 * `new Intl.NumberFormat()` is expensive: it resolves the locale data on every
 * call. Rendering a table of a couple of thousand rows calls `formatNumber` and
 * `formatPercent` tens of thousands of times per paint, and building a formatter
 * for each of those blocked the main thread long enough for the browser to
 * declare the page unresponsive.
 */
const numberFormatter = new Intl.NumberFormat(locale);

const scoreFormatters = new Map<number, Intl.NumberFormat>();

function scoreFormatter(fractionDigits: number) {
  let formatter = scoreFormatters.get(fractionDigits);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: fractionDigits });
    scoreFormatters.set(fractionDigits, formatter);
  }
  return formatter;
}

const dateFormatter = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });

const dateTimeFormatter = new Intl.DateTimeFormat(locale, {
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatNumber(value: number) {
  return numberFormatter.format(value);
}

export function formatPercent(value: number | null, fractionDigits = 1) {
  if (value === null || Number.isNaN(value)) return "—";
  return `${scoreFormatter(fractionDigits).format(value)}٪`;
}

export function formatScore(value: number | null, fractionDigits = 1) {
  if (value === null || Number.isNaN(value)) return "—";
  return scoreFormatter(fractionDigits).format(value);
}

export function formatDate(value: Date | string) {
  return dateFormatter.format(new Date(value));
}

export function formatDateTime(value: Date | string) {
  return dateTimeFormatter.format(new Date(value));
}

export function percentOf(part: number, total: number) {
  if (total === 0) return null;
  return (part / total) * 100;
}