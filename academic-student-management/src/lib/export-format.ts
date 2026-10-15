/**
 * Formatting for spreadsheet cells, kept separate from `lib/format` on purpose.
 *
 * The interface formats for `ar-EG`, which writes Arabic-Indic digits: `٧٥٪`,
 * `٠١‏/٠٣‏/٢٠٢٦`. That is correct on screen and wrong in a workbook, because
 * Excel reads those as text and can no longer sort a date column or total a
 * percentage. Exports therefore pin Latin digits and hand real `Date` and `number`
 * values to Excel, letting the application own the display format.
 */

const locale = "ar-EG";
const numberingSystem = "latn";

// Built once: the matrix summary formats every student row, and constructing a
// formatter per row is wasteful on the server too.
const numberFormatter = new Intl.NumberFormat(locale, { numberingSystem });

export function exportNumber(value: number) {
  return numberFormatter.format(value);
}

/**
 * A percentage as a number Excel can total, with no unit appended. The column is
 * labelled `نسبة الحضور %` instead, because a `٪` suffix turns the cell into text
 * and breaks both sorting and the chart tooltip.
 */
export function exportPercentNumber(value: number | null) {
  return value === null || Number.isNaN(value) ? null : Number(value.toFixed(1));
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

/**
 * A calendar day as `YYYY-MM-DD`, built from the UTC parts.
 *
 * A real Excel date cell was the first choice, but SheetJS converts between a
 * `Date` and Excel's serial day count through the machine's timezone, and the
 * round trip moved every date by a day. `AttendanceSession.date` is a `@db.Date`,
 * so it carries no time and no zone: reading the UTC parts is exact.
 *
 * ISO text sorts correctly in Excel, is unambiguous for whoever opens the file in
 * any locale, and can still be turned into a date with one click if needed.
 */
export function exportDate(value: Date) {
  return (
    `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`
  );
}

/**
 * A moment in time as `YYYY-MM-DD HH:MM`, from the UTC parts.
 *
 * The recorded time comes from `AttendanceRecord.updatedAt`, a real timestamp.
 * UTC is used rather than the server's local zone so the same lecture always
 * exports the same value, whatever machine builds the file.
 */
export function exportDateTime(value: Date) {
  return (
    `${exportDate(value)} ${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}`
  );
}