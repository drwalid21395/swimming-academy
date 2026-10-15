"use client";

import { CheckCheck, Eraser, Save } from "lucide-react";
import { memo, useActionState, useCallback, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Spinner } from "@/components/ui/loading";
import { attendanceTone, Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { SortableTHButton } from "@/components/ui/sortable-th";
import {
  RowSelectCheckbox,
  SelectAllRowsCheckbox,
  SelectionBar,
  TableSelectionProvider,
  useTableSelection,
} from "@/components/ui/table-selection";
import { formatNumber, formatPercent } from "@/lib/format";
import { useIsDesktop } from "@/hooks/use-media-query";
import {
  nextAttendanceSort,
  sortSheetRows,
  type AttendanceSort,
  type AttendanceSortField,
} from "@/lib/attendance-sort";
import type { SheetRow } from "@/lib/attendance";

import { saveAttendanceAction, type AttendanceActionState } from "./actions";

const initialState: AttendanceActionState = { status: "idle" };

const options = [
  { value: "PRESENT", label: "حاضر", active: "bg-emerald-500 text-white ring-emerald-500/30" },
  { value: "ABSENT", label: "غائب", active: "bg-rose-500 text-white ring-rose-500/30" },
  { value: "EXCUSED", label: "بعذر", active: "bg-amber-500 text-white ring-amber-500/30" },
] as const;

type Draft = { status: string; reason: string };

/**
 * Shared fallback so a row without a draft keeps the same object identity. A new
 * object on every render would defeat the `memo` below and re-render the sheet.
 */
const EMPTY_DRAFT: Draft = { status: "", reason: "" };

/**
 * The three status choices plus the hidden fields the form submits.
 *
 * The choices are buttons rather than radio inputs. A roster of two thousand
 * students put eight thousand form controls on the page, three per student, and
 * laying them out blocked the main thread for over half a second at a time, which
 * is long enough for the browser to report the page as not responding. Only one
 * hidden `status` input is posted per student now, so the submitted shape is
 * unchanged.
 *
 * Extracted because the sheet is rendered twice: as a table on wide screens and
 * as a card per student on a phone. Both copies have to post the same field
 * names, or saving would work on one layout and silently drop the other.
 */
function StatusPicker({
  draft,
  studentId,
  onStatus,
}: {
  draft: Draft;
  studentId: string;
  onStatus: (studentId: string, status: string) => void;
}) {
  return (
    <>
      <input name="studentId" type="hidden" value={studentId} />
      <input name="reason" type="hidden" value={draft.reason} />
      <input name="status" type="hidden" value={draft.status} />

      {/*
        The selection checkbox lives in its own leading column, deliberately
        outside this group: ticking a student must not decide their status, which
        is the whole point of marking a part of the roster in one step.
      */}
      <div aria-label="حالة الطالب" className="flex flex-wrap gap-1.5" role="group">
        {options.map((option) => {
          const active = draft.status === option.value;

          return (
            <button
              aria-pressed={active}
              className={`flex-1 cursor-pointer rounded-xl px-3 py-2 text-center text-xs font-bold ring-1 ring-inset transition ${
                active
                  ? option.active
                  : "bg-[var(--field-bg)] text-slate-500 ring-[var(--glass-border)] hover:bg-[var(--glass-bg-strong)]"
              }`}
              key={option.value}
              onClick={() => onStatus(studentId, option.value)}
              type="button"
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </>
  );
}

/**
 * The free-text reason, rendered only once a student is marked absent or excused.
 *
 * It used to be rendered for every row and merely disabled while the status was
 * still unset, which left one controlled input per student in the DOM doing
 * nothing. The hidden input in `StatusPicker` always carries the value, so the
 * action still reads one `reason` per `studentId` in the same order.
 */
function ReasonInput({
  draft,
  studentId,
  fullName,
  onReason,
  className,
}: {
  draft: Draft;
  studentId: string;
  fullName: string;
  onReason: (studentId: string, reason: string) => void;
  className?: string;
}) {
  if (draft.status === "PRESENT" || draft.status === "") return null;

  return (
    <Input
      aria-label={`سبب غياب ${fullName}`}
      className={className}
      onChange={(event) => onReason(studentId, event.target.value)}
      placeholder="سبب الغياب"
      value={draft.reason}
    />
  );
}

/** Sort control for the phone layout, where the table headers are hidden. */
function MobileSortButton({
  active,
  field,
  label,
  sort,
  onSort,
}: {
  active: boolean;
  field: AttendanceSortField;
  label: string;
  sort: AttendanceSort;
  onSort: (field: AttendanceSortField) => void;
}) {
  return (
    <button
      className={`rounded-xl px-3 py-2 text-xs font-bold ring-1 ring-inset transition ${
        active
          ? "bg-brand-500 text-white ring-brand-500/30"
          : "bg-[var(--field-bg)] text-slate-500 ring-[var(--glass-border)]"
      }`}
      onClick={() => onSort(field)}
      type="button"
    >
      {label}
      {active && <span className="ms-1">{sort.dir === "asc" ? "↑" : "↓"}</span>}
    </button>
  );
}

type SortableRow = SheetRow & { attendancePercentage: number | null };

/**
 * One student row, memoised on purpose.
 *
 * Every radio used to live in the sheet's single `drafts` state, so pressing one
 * status re-rendered all of them at once, which is what made marking a large
 * session feel slow. Marking a status only replaces that one student's draft
 * object and leaves the others identical, so `memo` limits the work to the row
 * that actually changed.
 */
const SheetStudentRow = memo(function SheetStudentRow({
  row,
  draft,
  attendanceLimit,
  onStatus,
  onReason,
}: {
  row: SortableRow;
  draft: Draft;
  attendanceLimit: number;
  onStatus: (studentId: string, status: string) => void;
  onReason: (studentId: string, reason: string) => void;
}) {
  return (
    <tr className="row-hover">
      <td className="border-y border-[var(--glass-border)] bg-[var(--glass-bg)] px-2 py-2.5 text-center">
        <RowSelectCheckbox id={row.studentId} label={`تحديد ${row.fullName}`} />
      </td>
      {/* The serial the student carries in the uploaded roster. */}
      <td
        className="rounded-r-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] px-3 py-2.5 text-xs text-muted"
        dir="ltr"
      >
        {row.serial ?? "—"}
      </td>
      <td className="border-y border-[var(--glass-border)] bg-[var(--glass-bg)] px-3 py-2.5">
        <span className="block font-bold text-[var(--app-text)]">{row.fullName}</span>
        <span className="block text-xs text-muted">الفرقة {formatNumber(row.academicYear)}</span>
      </td>
      <td
        className="border-y border-[var(--glass-border)] bg-[var(--glass-bg)] px-3 py-2.5 text-xs text-muted"
        dir="ltr"
      >
        {row.universityId}
      </td>
      <td className="border-y border-[var(--glass-border)] bg-[var(--glass-bg)] px-3 py-2.5 text-xs text-muted">
        {row.specializationName ?? "—"}
      </td>
      <td className="border-y border-[var(--glass-border)] bg-[var(--glass-bg)] px-3 py-2.5 text-xs text-muted">
        {row.departmentName}
      </td>
      <td className="border-y border-[var(--glass-border)] bg-[var(--glass-bg)] px-3 py-2.5">
        <StatusPicker draft={draft} onStatus={onStatus} studentId={row.studentId} />
      </td>
      <td className="border-y border-[var(--glass-border)] bg-[var(--glass-bg)] px-3 py-2.5">
        <ReasonInput
          className="h-9 text-xs"
          draft={draft}
          fullName={row.fullName}
          onReason={onReason}
          studentId={row.studentId}
        />
      </td>
      <td className="rounded-l-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] px-3 py-2.5">
        <div className="mb-1 flex items-center justify-between gap-2 text-xs">
          <span className="text-muted">{formatPercent(row.overall.percentage)}</span>
          {row.isLow && <Badge tone="danger">دون {formatNumber(attendanceLimit)}٪</Badge>}
        </div>
        <Progress size="sm" tone={attendanceTone(row.overall.percentage)} value={row.overall.percentage} />
      </td>
    </tr>
  );
});

/**
 * One student as a card, used below the `md` breakpoint.
 *
 * Memoised for the same reason as the table row: marking a status replaces a
 * single draft, and without `memo` the whole phone list would re-render.
 */
const SheetStudentCard = memo(function SheetStudentCard({
  row,
  draft,
  attendanceLimit,
  onStatus,
  onReason,
}: {
  row: SortableRow;
  draft: Draft;
  attendanceLimit: number;
  onStatus: (studentId: string, status: string) => void;
  onReason: (studentId: string, reason: string) => void;
}) {
  const { isSelected, toggle } = useTableSelection();

  return (
    <div
      className={`rounded-2xl border bg-[var(--glass-bg)] p-3 ${
        isSelected(row.studentId)
          ? "border-brand-500 ring-1 ring-brand-500/30"
          : "border-[var(--glass-border)]"
      }`}
    >
      <div className="mb-2 flex items-start justify-between gap-3">
        <label className="flex shrink-0 cursor-pointer items-center pt-0.5">
          <input
            aria-label={`تحديد ${row.fullName}`}
            checked={isSelected(row.studentId)}
            className="size-4 cursor-pointer accent-brand-600"
            onChange={() => toggle(row.studentId)}
            type="checkbox"
          />
        </label>
        <div className="min-w-0">
          <p className="truncate font-bold text-[var(--app-text)]">{row.fullName}</p>
          <p className="mt-0.5 text-xs text-muted" dir="ltr">
            {row.serial ?? "—"} · {row.universityId}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted">
            الفرقة {formatNumber(row.academicYear)} · {row.specializationName ?? "—"} ·{" "}
            {row.departmentName}
          </p>
        </div>
        <div className="shrink-0 text-start">
          <p className="text-sm font-bold text-[var(--app-text)]">
            {formatPercent(row.overall.percentage)}
          </p>
          {row.isLow && (
            <Badge className="mt-1" tone="danger">
              دون {formatNumber(attendanceLimit)}٪
            </Badge>
          )}
        </div>
      </div>

      <StatusPicker draft={draft} onStatus={onStatus} studentId={row.studentId} />

      <ReasonInput
        className="mt-2 h-10 text-sm"
        draft={draft}
        fullName={row.fullName}
        onReason={onReason}
        studentId={row.studentId}
      />
    </div>
  );
});

/**
 * The sheet, wrapped in the shared row-selection provider.
 *
 * The provider sits above the marking form rather than inside it because both the
 * per-row checkbox and the bulk "mark the ticked students" shortcuts read the
 * selection, and a hook cannot reach a context its own component provides.
 */
export function AttendanceSheet(props: {
  sessionId: string;
  rows: SheetRow[];
  attendanceLimit: number;
  readOnly: boolean;
}) {
  return (
    <TableSelectionProvider ids={props.rows.map((row) => row.studentId)}>
      {props.readOnly ? (
        <p className="rounded-2xl border border-dashed border-[var(--glass-border)] px-4 py-6 text-center text-sm text-muted">
          لا تملك صلاحية تعديل سجلات الحضور. يمكنك عرض السجلات فقط.
        </p>
      ) : (
        <AttendanceSheetForm {...props} />
      )}
    </TableSelectionProvider>
  );
}

function AttendanceSheetForm({
  sessionId,
  rows,
  attendanceLimit,
}: {
  sessionId: string;
  rows: SheetRow[];
  attendanceLimit: number;
}) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(
      rows.map((row) => [row.studentId, { status: row.status ?? "", reason: row.reason ?? "" }]),
    ),
  );
  const [state, formAction, pending] = useActionState(saveAttendanceAction, initialState);
  const [sort, setSort] = useState<AttendanceSort>({ field: "fullName", dir: "asc" });

  // Functional updates keep these callbacks free of `drafts`, so their identity
  // never changes and `memo` can actually skip the untouched rows.
  const setStatus = useCallback((studentId: string, status: string) => {
    setDrafts((current) => ({
      ...current,
      [studentId]: {
        status,
        reason: status === "PRESENT" ? "" : (current[studentId]?.reason ?? ""),
      },
    }));
  }, []);

  const setReason = useCallback((studentId: string, reason: string) => {
    setDrafts((current) => ({
      ...current,
      [studentId]: { status: current[studentId]?.status ?? "", reason },
    }));
  }, []);

  const toggleSort = useCallback((field: AttendanceSortField) => {
    setSort((current) => nextAttendanceSort(current, field));
  }, []);

  const { allSelected, clear: clearSelection, selectedIds, toggleAll } = useTableSelection();

  /** Applies a status to every student, which is what the two shortcuts do. */
  const markAll = (status: string) => {
    setDrafts((current) =>
      Object.fromEntries(
        Object.entries(current).map(([studentId, draft]) => [
          studentId,
          { status, reason: status === "PRESENT" ? "" : draft.reason },
        ]),
      ),
    );
  };

  /**
   * Applies a status to the ticked students only.
   *
   * Marking a subset is the case a roster of two thousand makes necessary: one
   * absentee among many is not worth scrolling through the whole sheet to find,
   * and marking everyone present first would then have to be undone by hand.
   * Marking present clears the reason, matching `markAll`, because a present
   * student with an excuse left over is a contradiction the action would store.
   */
  const markSelected = (status: string) => {
    if (selectedIds.length === 0) return;

    setDrafts((current) => {
      const next = { ...current };
      for (const studentId of selectedIds) {
        next[studentId] = {
          status,
          reason: status === "PRESENT" ? "" : (current[studentId]?.reason ?? ""),
        };
      }
      return next;
    });
  };

  /**
   * Sorted in memory on purpose. A URL-driven sort would re-run the server
   * query and throw away every unsaved status, which is the one thing this
   * sheet cannot afford to lose.
   */
  const sortedRows = useMemo(
    () =>
      sortSheetRows(
        rows.map((row) => ({ ...row, attendancePercentage: row.overall.percentage })),
        sort,
      ),
    [rows, sort],
  );

  const counts = useMemo(() => {
    const result = { PRESENT: 0, ABSENT: 0, EXCUSED: 0, missing: 0 };
    for (const row of rows) {
      const status = drafts[row.studentId]?.status;
      if (status === "PRESENT") result.PRESENT += 1;
      else if (status === "ABSENT") result.ABSENT += 1;
      else if (status === "EXCUSED") result.EXCUSED += 1;
      else result.missing += 1;
    }
    return result;
  }, [drafts, rows]);

  const isDesktop = useIsDesktop();

  return (
    <>
      <SelectionBar noun="طالب">
        {options.map((option) => (
          <Button
            key={option.value}
            onClick={() => markSelected(option.value)}
            size="sm"
            type="button"
            variant="secondary"
          >
            تحديد {option.label}
          </Button>
        ))}
        <Button onClick={clearSelection} size="sm" type="button" variant="ghost">
          مسح التحديد
        </Button>
      </SelectionBar>

      <form action={formAction} className="space-y-4">
        <input name="sessionId" type="hidden" value={sessionId} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone="success">{formatNumber(counts.PRESENT)} حاضر</Badge>
          <Badge tone="danger">{formatNumber(counts.ABSENT)} غائب</Badge>
          <Badge tone="warning">{formatNumber(counts.EXCUSED)} بعذر</Badge>
          {counts.missing > 0 && (
            <Badge tone="neutral">{formatNumber(counts.missing)} بدون تسجيل</Badge>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={toggleAll} size="sm" type="button" variant="secondary">
            <CheckCheck aria-hidden className="size-4" />
            {allSelected ? "إلغاء تحديد الكل" : "تحديد الكل"}
          </Button>
          <Button onClick={() => markAll("PRESENT")} size="sm" type="button" variant="secondary">
            <CheckCheck aria-hidden className="size-4" />
            تحضير الجميع
          </Button>
          <Button onClick={() => markAll("")} size="sm" type="button" variant="ghost">
            <Eraser aria-hidden className="size-4" />
            مسح الحالات
          </Button>
        </div>
      </div>

      {/*
        Phone layout. A sheet row carries seven columns and a minimum width of
        62rem, which meant a phone had to scroll sideways through every student to
        reach the status buttons. Below `md` each student becomes a card, so the
        status and the reason field sit in the thumb's reach without any sideways
        movement.

        Only one layout is ever in the DOM: keeping both and hiding one with CSS
        doubled the nodes per student, and duplicating the status inputs meant two
        sets of fields with the same name were submitted together.
      */}
      <div className="flex flex-wrap gap-2 md:hidden">
        <MobileSortButton
          active={sort.field === "serial"}
          field="serial"
          label="المسلسل"
          onSort={toggleSort}
          sort={sort}
        />
        <MobileSortButton
          active={sort.field === "fullName"}
          field="fullName"
          label="الاسم"
          onSort={toggleSort}
          sort={sort}
        />
        <MobileSortButton
          active={sort.field === "universityId"}
          field="universityId"
          label="الرقم الجامعي"
          onSort={toggleSort}
          sort={sort}
        />
        <MobileSortButton
          active={sort.field === "attendance"}
          field="attendance"
          label="النسبة"
          onSort={toggleSort}
          sort={sort}
        />
      </div>

      {isDesktop ? (
        <table className="w-full min-w-[62rem] border-separate border-spacing-y-2 text-right text-sm">
          <thead className="sticky top-0 z-10 bg-[var(--glass-bg-strong)] text-xs font-bold text-muted backdrop-blur-xl">
            <tr>
              <th className="w-10 px-2 pb-1 text-center">
                <SelectAllRowsCheckbox label="تحديد كل الطلاب" />
              </th>
              <SortableTHButton
                active={sort.field === "serial"}
                className="w-14 px-3"
                dir={sort.dir}
                onClick={() => toggleSort("serial")}
              >
                المسلسل
              </SortableTHButton>
              <SortableTHButton
                active={sort.field === "fullName"}
                className="px-3"
                dir={sort.dir}
                onClick={() => toggleSort("fullName")}
              >
                الطالب
              </SortableTHButton>
              <SortableTHButton
                active={sort.field === "universityId"}
                className="px-3"
                dir={sort.dir}
                onClick={() => toggleSort("universityId")}
              >
                الرقم الجامعي
              </SortableTHButton>
              <SortableTHButton
                active={sort.field === "specialization"}
                className="px-3"
                dir={sort.dir}
                onClick={() => toggleSort("specialization")}
              >
                التخصص
              </SortableTHButton>
              <SortableTHButton
                active={sort.field === "department"}
                className="px-3"
                dir={sort.dir}
                onClick={() => toggleSort("department")}
              >
                القسم
              </SortableTHButton>
              <th className="px-3 pb-1">الحالة</th>
              <th className="w-44 px-3 pb-1">السبب / ملاحظة</th>
              <SortableTHButton
                active={sort.field === "attendance"}
                className="px-3"
                dir={sort.dir}
                onClick={() => toggleSort("attendance")}
              >
                نسبة الحضور الكلية
              </SortableTHButton>
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => (
              <SheetStudentRow
                attendanceLimit={attendanceLimit}
                draft={drafts[row.studentId] ?? EMPTY_DRAFT}
                key={row.studentId}
                onReason={setReason}
onStatus={setStatus}
              row={row}
            />
            ))}
          </tbody>
        </table>
      ) : (
        <div className="space-y-3">
          {sortedRows.map((row) => (
            <SheetStudentCard
              attendanceLimit={attendanceLimit}
              draft={drafts[row.studentId] ?? EMPTY_DRAFT}
              key={row.studentId}
              onReason={setReason}
              onStatus={setStatus}
              row={row}
            />
          ))}
        </div>
      )}

      {state.message && (
        <p
          className={`rounded-2xl px-4 py-3 text-sm font-semibold ring-1 ring-inset ${
            state.status === "success"
              ? "bg-emerald-500/12 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300"
              : "bg-rose-500/12 text-rose-700 ring-rose-500/25 dark:text-rose-300"
          }`}
          role="status"
        >
          {state.message}
        </p>
      )}

      <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--glass-border)] pt-4">
        <Button disabled={pending} type="submit">
          {pending ? <Spinner /> : <Save aria-hidden className="size-4" />}
          {pending ? "جارٍ الحفظ..." : "حفظ سجلات الحضور"}
        </Button>
      </div>
      </form>
    </>
  );
}