"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useActionState, useEffect, useState, useTransition } from "react";
import { UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Spinner } from "@/components/ui/loading";
import { Modal } from "@/components/ui/modal";
import { formatNumber } from "@/lib/format";
import type { EnrollableStudent } from "@/lib/subjects";

import { enrollStudentsAction, type SubjectActionState } from "./actions";

const initialState: SubjectActionState = { status: "idle" };

export function EnrollStudentsDialog({
  subjectId,
  subjectName,
  students,
}: {
  subjectId: string;
  subjectName: string;
  students: EnrollableStudent[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [searching, startSearch] = useTransition();
  const [state, formAction, pending] = useActionState(enrollStudentsAction, initialState);

  useEffect(() => {
    if (state.status === "success") {
      setSelected([]);
      setQuery("");
      router.refresh();
    }
  }, [state.status, router]);

  useEffect(() => {
    if (!open) return;

    const current = searchParams.get("enrollQuery") ?? "";
    if (current === query) return;

    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (query) params.set("enrollQuery", query);
      else params.delete("enrollQuery");

      startSearch(() => {
        router.replace(params.toString() ? `?${params.toString()}` : "?", { scroll: false });
      });
    }, 350);

    return () => clearTimeout(timer);
  }, [open, query, router, searchParams]);

  const available = students.filter((student) => !student.isEnrolled);
  const pendingCount = selected.length;

  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm" variant="secondary">
        <UserPlus aria-hidden className="size-4" />
        تسجيل طلاب
      </Button>

      <Modal
        description={`اختر الطلاب المراد تسجيلهم في مادة ${subjectName}.`}
        onClose={() => setOpen(false)}
        open={open}
        size="lg"
        title="تسجيل طلاب في المادة"
      >
        <form action={formAction} className="space-y-4" noValidate>
          <input name="subjectId" type="hidden" value={subjectId} />

          <Input
            onChange={(event) => setQuery(event.target.value)}
            placeholder="ابحث بالاسم أو الرقم الجامعي"
            type="search"
            value={query}
          />

          <div className="max-h-80 space-y-2 overflow-y-auto pl-1">
            {searching && (
              <p className="flex items-center gap-2 py-6 text-center text-sm text-muted">
                <Spinner /> جارٍ البحث...
              </p>
            )}

            {!searching && available.length === 0 && (
              <p className="rounded-2xl border border-dashed border-[var(--glass-border)] px-4 py-8 text-center text-sm text-muted">
                لا يوجد طلاب متاحون للتسجيل.
              </p>
            )}

            {!searching &&
              available.map((student) => {
                const isSelected = selected.includes(student.id);

                return (
                  <label
                    className="row-hover flex cursor-pointer items-center gap-3 rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] px-4 py-3"
                    key={student.id}
                  >
                    <input
                      checked={isSelected}
                      className="size-4 accent-brand-600"
                      name="studentId"
                      onChange={(event) =>
                        setSelected((current) =>
                          event.target.checked
                            ? [...current, student.id]
                            : current.filter((id) => id !== student.id),
                        )
                      }
                      type="checkbox"
                      value={student.id}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold">{student.fullName}</span>
                      <span className="block truncate text-xs text-muted" dir="ltr">
                        {student.email} · {student.universityId}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-muted">
                      {student.departmentName} · الفرقة {formatNumber(student.academicYear)}
                    </span>
                  </label>
                );
              })}
          </div>

          {state.status === "error" && state.message && (
            <p
              className="rounded-2xl bg-rose-500/12 px-4 py-3 text-sm font-semibold text-rose-700 ring-1 ring-inset ring-rose-500/25 dark:text-rose-300"
              role="alert"
            >
              {state.message}
            </p>
          )}

          {state.status === "success" && (
            <p className="rounded-2xl bg-emerald-500/12 px-4 py-3 text-sm font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-500/25 dark:text-emerald-300">
              {state.message}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--glass-border)] pt-4">
            <p className="text-sm text-muted">تم تحديد {formatNumber(pendingCount)} طالب</p>
            <div className="flex gap-2">
              <Button onClick={() => setOpen(false)} type="button" variant="secondary">
                إغلاق
              </Button>
              <Button disabled={pending || pendingCount === 0} type="submit">
                {pending && <Spinner />}
                {pending ? "جارٍ التسجيل..." : "تسجيل الطلاب"}
              </Button>
            </div>
          </div>
        </form>
      </Modal>
    </>
  );
}
