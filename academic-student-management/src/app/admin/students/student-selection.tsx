"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/loading";
import {
  RowSelectCheckbox,
  SelectAllRowsCheckbox,
  SelectionBar,
  TableSelectionProvider,
  useTableSelection,
} from "@/components/ui/table-selection";
import { formatNumber } from "@/lib/format";
import type { SubjectPickerOption } from "@/lib/subjects";

import { deleteStudentsAction, type StudentActionState } from "./actions";
import { EnrollSelectedDialog } from "./enroll-selected-dialog";

export type StudentSelectionTarget = {
  id: string;
  fullName: string;
  universityId: string;
};

const initialState: StudentActionState = { status: "idle" };

/**
 * The bulk actions for the students table, rendered inside the shared selection bar.
 *
 * Selection itself lives in `components/ui/table-selection`; this component only
 * decides what deleting students does and how a confirmed delete is worded.
 */
function StudentBulkActions({
  canDelete,
  canEnroll,
  filters,
  isTruncated,
  matchingCount,
  students,
  subjects,
}: {
  canDelete: boolean;
  canEnroll: boolean;
  filters: {
    query?: string;
    departmentId?: string;
    academicYear?: string;
    attendanceState?: string;
  };
  matchingCount: number;
  isTruncated: boolean;
  students: StudentSelectionTarget[];
  subjects: SubjectPickerOption[];
}) {
  const router = useRouter();
  const { clear, selectedIds } = useTableSelection();
  const [state, formAction, deleting] = useActionState(deleteStudentsAction, initialState);

  // The selection is meaningless once the page re-renders after a delete.
  useEffect(() => {
    if (state.status !== "success") return;
    clear();
    router.refresh();
  }, [state.status, clear, router]);

  const named = students
    .filter((student) => selectedIds.includes(student.id))
    .slice(0, 5)
    .map((student) => student.fullName)
    .join("، ");
  const rest = selectedIds.length - Math.min(5, selectedIds.length);

  return (
    <>
      {canEnroll && (
        <EnrollSelectedDialog
          filters={filters}
          isTruncated={isTruncated}
          matchingCount={matchingCount}
          onEnrolled={clear}
          selectedIds={selectedIds}
          subjects={subjects}
        />
      )}

      {canDelete && (
        <>
          {/* Deletes everything the current filters resolve to, not only this page. */}
          <form action={formAction}>
            <input name="confirm" type="hidden" value="yes" />
            <input name="scope" type="hidden" value="filtered" />
            <input name="query" type="hidden" value={filters.query ?? ""} />
            <input name="departmentId" type="hidden" value={filters.departmentId ?? ""} />
            <input name="academicYear" type="hidden" value={filters.academicYear ?? ""} />
            <input name="attendanceState" type="hidden" value={filters.attendanceState ?? "all"} />
            <Button
              disabled={deleting || matchingCount === 0}
              onClick={(event) => {
                const confirmed = window.confirm(
                  `سيتم حذف ${formatNumber(matchingCount)} طالب نهائياً مع كل سجلات حضورهم ودرجاتهم. لا يمكن التراجع. هل تريد المتابعة؟`,
                );
                if (!confirmed) event.preventDefault();
              }}
              size="sm"
              type="submit"
              variant="secondary"
            >
              {deleting ? <Spinner /> : <Trash2 aria-hidden className="size-4" />}
              حذف كل النتائج ({formatNumber(matchingCount)})
            </Button>
          </form>

          <form
            action={formAction}
            onSubmit={(event) => {
              const confirmed = window.confirm(
                `سيتم حذف ${formatNumber(selectedIds.length)} طالب نهائياً: ${named}${rest > 0 ? ` و${formatNumber(rest)} آخرين` : ""}. هل تريد المتابعة؟`,
              );
              if (!confirmed) event.preventDefault();
            }}
          >
            <input name="confirm" type="hidden" value="yes" />
            <input name="scope" type="hidden" value="selected" />
            {selectedIds.map((id) => (
              <input key={id} name="studentIds" type="hidden" value={id} />
            ))}
            <Button
              disabled={deleting || selectedIds.length === 0}
              size="sm"
              type="submit"
              variant="danger"
            >
              {deleting ? <Spinner /> : <Trash2 aria-hidden className="size-4" />}
              حذف المحدد ({formatNumber(selectedIds.length)})
            </Button>
          </form>
        </>
      )}
    </>
  );
}

/**
 * Wraps the students table so rows can be ticked and deleted or enrolled in bulk.
 *
 * When neither capability is granted the table renders exactly as it did before
 * selection existed, with no checkbox column, because ticking rows could not lead
 * anywhere.
 */
export function StudentSelectionProvider({
  children,
  canDelete,
  canEnroll,
  filters,
  matchingCount,
  isTruncated,
  students,
  subjects,
}: {
  children: React.ReactNode;
  canDelete: boolean;
  canEnroll: boolean;
  filters: {
    query?: string;
    departmentId?: string;
    academicYear?: string;
    attendanceState?: string;
  };
  matchingCount: number;
  isTruncated: boolean;
  students: StudentSelectionTarget[];
  subjects: SubjectPickerOption[];
}) {
  if (!canDelete && !canEnroll) return <>{children}</>;

  return (
    <TableSelectionProvider ids={students.map((student) => student.id)}>
      {children}

      <SelectionBar
        noun="طالب"
        notice={
          isTruncated ? (
            <p className="text-xs text-amber-600">
              الإجراءات الجماعية على كل النتائج تغطي أول {formatNumber(matchingCount)} نتيجة فقط، استخدم الفلاتر
              لتضييق النطاق.
            </p>
          ) : undefined
        }
      >
        <StudentBulkActions
          canDelete={canDelete}
          canEnroll={canEnroll}
          filters={filters}
          isTruncated={isTruncated}
          matchingCount={matchingCount}
          students={students}
          subjects={subjects}
        />
      </SelectionBar>
    </TableSelectionProvider>
  );
}

export function StudentSelectCheckbox({ studentId }: { studentId: string }) {
  return <RowSelectCheckbox id={studentId} label="تحديد الطالب" />;
}

export function SelectAllStudentsCheckbox() {
  return <SelectAllRowsCheckbox label="تحديد كل الطلاب المعروضين" />;
}