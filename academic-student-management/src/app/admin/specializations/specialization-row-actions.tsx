"use client";

import { Trash2 } from "lucide-react";
import { useActionState, useState } from "react";

import { Spinner } from "@/components/ui/loading";
import type { SpecializationEditData } from "@/lib/specializations";

import type { DepartmentOption } from "../students/student-filters";
import { deleteSpecializationAction, type SpecializationActionState } from "./actions";
import { SpecializationFormDialog } from "./specialization-form-dialog";

const initialState: SpecializationActionState = { status: "idle" };

export function SpecializationRowActions({
  specialization,
  departments,
  canManage,
  canDelete,
}: {
  specialization: SpecializationEditData & { studentsCount: number };
  departments: DepartmentOption[];
  canManage: boolean;
  canDelete: boolean;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    deleteSpecializationAction,
    initialState,
  );

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center justify-end gap-1.5">
        {canManage && (
          <SpecializationFormDialog
            departments={departments}
            mode="edit"
            onOpenChange={setEditOpen}
            open={editOpen}
            specialization={specialization}
          />
        )}

        {canDelete && (
          <form
            action={formAction}
            onSubmit={(event) => {
              const confirmed = window.confirm(
                `سيتم حذف التخصص "${specialization.name}" نهائياً. لا يمكن الحذف إذا كان مرتبطاً بطلاب. هل تريد المتابعة؟`,
              );
              if (!confirmed) event.preventDefault();
            }}
          >
            <input name="specializationId" type="hidden" value={specialization.id} />
            <button
              className="rounded-lg p-2 text-rose-600 transition hover:bg-rose-50 disabled:opacity-50 dark:hover:bg-rose-950/60"
              disabled={pending}
              title="حذف التخصص"
              type="submit"
            >
              {pending ? <Spinner /> : <Trash2 aria-hidden className="size-4" />}
            </button>
          </form>
        )}
      </div>

      {state.status === "error" && state.message && (
        <p className="max-w-56 text-end text-xs font-medium text-rose-600" role="alert">
          {state.message}
        </p>
      )}
    </div>
  );
}
