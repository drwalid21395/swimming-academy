"use client";

import { BookPlus, Layers, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Spinner } from "@/components/ui/loading";
import { Modal } from "@/components/ui/modal";
import { formatNumber } from "@/lib/format";
import type { SubjectPickerOption } from "@/lib/subjects";

import { enrollSelectedStudentsAction, type StudentActionState } from "./actions";

const initialState: StudentActionState = { status: "idle" };

type Scope = "selected" | "filtered";

export function EnrollSelectedDialog({
  filters,
  isTruncated,
  matchingCount,
  onEnrolled,
  selectedIds,
  subjects,
}: {
  filters: {
    query?: string;
    departmentId?: string;
    academicYear?: string;
    attendanceState?: string;
  };
  isTruncated: boolean;
  matchingCount: number;
  onEnrolled: () => void;
  selectedIds: string[];
  subjects: SubjectPickerOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(enrollSelectedStudentsAction, initialState);

  const [scope, setScope] = useState<Scope>("selected");
  const [allSubjects, setAllSubjects] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [search, setSearch] = useState("");

  // `onEnrolled` is recreated whenever the selection changes, so it is read
  // through a ref to keep the success effect keyed on the result alone.
  const onEnrolledRef = useRef(onEnrolled);
  onEnrolledRef.current = onEnrolled;

  useEffect(() => {
    if (state.status !== "success") return;
    setOpen(false);
    setPicked([]);
    setSearch("");
    onEnrolledRef.current();
    router.refresh();
  }, [state.status, router]);

  const visibleSubjects = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return subjects;
    return subjects.filter(
      (subject) =>
        subject.code.toLowerCase().includes(term) ||
        subject.name.toLowerCase().includes(term) ||
        subject.departmentName.toLowerCase().includes(term),
    );
  }, [search, subjects]);

  const targetStudents = scope === "filtered" ? matchingCount : selectedIds.length;
  const targetSubjects = allSubjects ? subjects.length : picked.length;
  const totalEnrollments = targetStudents * targetSubjects;

  const toggleSubject = (subjectId: string) =>
    setPicked((current) =>
      current.includes(subjectId) ? current.filter((id) => id !== subjectId) : [...current, subjectId],
    );

  const toggleVisible = () => {
    const visibleIds = visibleSubjects.map((subject) => subject.id);
    const everyVisiblePicked = visibleIds.length > 0 && visibleIds.every((id) => picked.includes(id));
    setPicked((current) =>
      everyVisiblePicked
        ? current.filter((id) => !visibleIds.includes(id))
        : [...new Set([...current, ...visibleIds])],
    );
  };

  const ready = targetStudents > 0 && targetSubjects > 0;

  return (
    <>
      <Button disabled={selectedIds.length === 0} onClick={() => setOpen(true)} size="sm" variant="outline">
        <BookPlus aria-hidden className="size-4" />
        إضافة إلى مادة
      </Button>

      <Modal
        description="سيتم تسجيل الطلاب المحددين في المواد التي تختارها. الطالب المسجل بالفعل يبقى كما هو، والمسحوب أو المكتمل يُرجَع إلى حالة نشطة."
        onClose={() => setOpen(false)}
        open={open}
        size="lg"
        title="إضافة طلاب إلى مواد"
      >
        <form action={formAction} className="space-y-5" noValidate>
          <input name="query" type="hidden" value={filters.query ?? ""} />
          <input name="departmentId" type="hidden" value={filters.departmentId ?? ""} />
          <input name="academicYear" type="hidden" value={filters.academicYear ?? ""} />
          <input name="attendanceState" type="hidden" value={filters.attendanceState ?? "all"} />
          <input name="allSubjects" type="hidden" value={allSubjects ? "yes" : ""} />
          {scope === "selected" &&
            selectedIds.map((id) => <input key={id} name="studentIds" type="hidden" value={id} />)}

          <fieldset className="space-y-2">
            <legend className="text-sm font-bold text-[var(--app-text)]">الطلاب</legend>
            <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-[var(--glass-border)] bg-[var(--field-bg)] px-4 py-3 text-sm">
              <input
                checked={scope === "selected"}
                className="mt-0.5 size-4 accent-brand-600"
                name="scope"
                onChange={() => setScope("selected")}
                type="radio"
                value="selected"
              />
              <span>
                <span className="font-bold text-[var(--app-text)]">
                  الطلاب المحددون ({formatNumber(selectedIds.length)})
                </span>
                <span className="mt-0.5 block text-xs text-muted">ما تم تحديده في الجدول أمامك الآن.</span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-[var(--glass-border)] bg-[var(--field-bg)] px-4 py-3 text-sm">
              <input
                checked={scope === "filtered"}
                className="mt-0.5 size-4 accent-brand-600"
                name="scope"
                onChange={() => setScope("filtered")}
                type="radio"
                value="filtered"
              />
              <span>
                <span className="font-bold text-[var(--app-text)]">
                  كل نتائج الفلاتر ({formatNumber(matchingCount)})
                </span>
                <span className="mt-0.5 block text-xs text-muted">
                  كل الطلاب المطابقون للبحث والتصفية، وليس الصفحة الحالية فقط.
                </span>
              </span>
            </label>
            {scope === "filtered" && isTruncated && (
              <p className="text-xs text-amber-600">
                الاستعلام يقرأ أول {formatNumber(matchingCount)} نتيجة فقط. لتغطية كل الطلاب فعلياً، ضيّق الفلاتر أو ابحث بالاسم.
              </p>
            )}
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-sm font-bold text-[var(--app-text)]">المواد</legend>
            <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-[var(--glass-border)] bg-[var(--field-bg)] px-4 py-3 text-sm">
              <input
                checked={allSubjects}
                className="mt-0.5 size-4 accent-brand-600"
                onChange={() => setAllSubjects((current) => !current)}
                type="checkbox"
              />
              <span>
                <span className="font-bold text-[var(--app-text)]">
                  كل المواد ({formatNumber(subjects.length)})
                </span>
                <span className="mt-0.5 block text-xs text-muted">
                  تسجّل الطلاب في كل المواد الموجودة في النظام، الحالية والقديمة.
                </span>
              </span>
            </label>

            {!allSubjects && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative min-w-56 flex-1">
                    <Search
                      aria-hidden
                      className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400"
                    />
                    <Input
                      aria-label="بحث في المواد"
                      className="pr-10"
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="ابحث بكود المادة أو اسمها أو القسم..."
                      type="search"
                      value={search}
                    />
                  </div>
                  <Button disabled={visibleSubjects.length === 0} onClick={toggleVisible} size="sm" variant="ghost">
                    <Layers aria-hidden className="size-4" />
                    {visibleSubjects.length > 0 && visibleSubjects.every((subject) => picked.includes(subject.id))
                      ? "إلغاء تحديد المعروض"
                      : "تحديد المعروض"}
                  </Button>
                </div>

                <div className="max-h-64 overflow-y-auto rounded-2xl border border-[var(--glass-border)] bg-[var(--field-bg)]">
                  {visibleSubjects.length === 0 ? (
                    <p className="px-4 py-6 text-center text-sm text-muted">لا توجد مواد مطابقة للبحث.</p>
                  ) : (
                    <ul className="divide-y divide-[var(--glass-border)]">
                      {visibleSubjects.map((subject) => (
                        <li key={subject.id}>
                          <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm hover:bg-brand-500/5">
                            <input
                              checked={picked.includes(subject.id)}
                              className="size-4 accent-brand-600"
                              name="subjectIds"
                              onChange={() => toggleSubject(subject.id)}
                              type="checkbox"
                              value={subject.id}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-semibold text-[var(--app-text)]">
                                {subject.name}
                              </span>
                              <span className="block truncate text-xs text-muted">
                                {subject.code} • {subject.departmentName} • {subject.academicTermName}
                              </span>
                            </span>
                            <span className="shrink-0 text-xs text-muted">
                              {formatNumber(subject.studentsCount)} طالب
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <p className="text-xs text-muted">تم اختيار {formatNumber(picked.length)} مادة.</p>
              </div>
            )}
          </fieldset>

          {state.status === "error" && state.message && (
            <p
              className="rounded-2xl bg-rose-500/12 px-4 py-3 text-sm font-semibold text-rose-700 ring-1 ring-inset ring-rose-500/25 dark:text-rose-300"
              role="alert"
            >
              {state.message}
            </p>
          )}

          <p className="rounded-2xl bg-brand-500/10 px-4 py-3 text-sm font-semibold text-brand-700 dark:text-brand-200">
            {ready
              ? `سيتم إنشاء ${formatNumber(totalEnrollments)} تسجيل لـ ${formatNumber(targetStudents)} طالب في ${formatNumber(targetSubjects)} مادة.`
              : "اختر الطلاب والمواد أولاً."}
          </p>

          <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--glass-border)] pt-4">
            <Button onClick={() => setOpen(false)} type="button" variant="secondary">
              إلغاء
            </Button>
            <Button
              disabled={pending || !ready}
              formNoValidate
              onClick={(event) => {
                const confirmed = window.confirm(
                  `سيتم تسجيل ${formatNumber(targetStudents)} طالب في ${formatNumber(targetSubjects)} مادة (${formatNumber(totalEnrollments)} تسجيل). هل تريد المتابعة؟`,
                );
                if (!confirmed) event.preventDefault();
              }}
              type="submit"
            >
              {pending && <Spinner />}
              {pending ? "جارٍ التسجيل..." : "تأكيد الإضافة"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}