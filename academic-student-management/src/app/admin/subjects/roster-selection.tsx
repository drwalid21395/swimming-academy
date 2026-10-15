"use client";

import { UserMinus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/loading";
import { SelectionBar, TableSelectionProvider, useTableSelection } from "@/components/ui/table-selection";
import { formatNumber } from "@/lib/format";

import { unenrollStudentsAction, type SubjectActionState } from "./actions";

const initialState: SubjectActionState = { status: "idle" };

/** The bulk action for a subject's roster: drop every ticked student. */
function BulkUnenroll({ subjectId }: { subjectId: string }) {
  const router = useRouter();
  const { clear, selectedIds } = useTableSelection();
  const [state, formAction, pending] = useActionState(unenrollStudentsAction, initialState);

  // The ticked students are gone once the page re-renders.
  useEffect(() => {
    if (state.status !== "success") return;
    clear();
    router.refresh();
  }, [state.status, clear, router]);

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        const confirmed = window.confirm(
          `سيتم إلغاء تسجيل ${formatNumber(selectedIds.length)} طالب من المادة وحذف سجلات حضورهم الخاصة بها. هل تريد المتابعة؟`,
        );
        if (!confirmed) event.preventDefault();
      }}
    >
      <input name="subjectId" type="hidden" value={subjectId} />
      {selectedIds.map((id) => (
        <input key={id} name="studentId" type="hidden" value={id} />
      ))}
      <Button disabled={pending} size="sm" type="submit" variant="danger">
        {pending ? <Spinner /> : <UserMinus aria-hidden className="size-4" />}
        إلغاء تسجيل المحدد ({formatNumber(selectedIds.length)})
      </Button>
    </form>
  );
}

/**
 * Enables part-or-all selection on a subject's roster table.
 *
 * The single-student unenroll button stays on each row, so a lone removal is still
 * one click; this only adds the multi-row path. Without `subjects.manage` the
 * table is left exactly as it was, because there is nothing a selection could do.
 */
export function RosterSelectionProvider({
  canManage,
  children,
  studentIds,
  subjectId,
}: {
  canManage: boolean;
  children: React.ReactNode;
  studentIds: string[];
  subjectId: string;
}) {
  if (!canManage) return <>{children}</>;

  return (
    <TableSelectionProvider ids={studentIds}>
      {children}

      <SelectionBar noun="طالب">
        <BulkUnenroll subjectId={subjectId} />
      </SelectionBar>
    </TableSelectionProvider>
  );
}