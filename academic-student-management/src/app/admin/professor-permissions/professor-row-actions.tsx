"use client";

import { Power, Trash2 } from "lucide-react";
import { useActionState } from "react";

import { Spinner } from "@/components/ui/loading";
import type { ProfessorEditData } from "@/lib/professors";

import { ProfessorFormDialog } from "./professor-form-dialog";
import {
  deleteProfessorAction,
  toggleProfessorActiveAction,
  type ProfessorPermissionActionState,
} from "./actions";

const initialState: ProfessorPermissionActionState = { status: "idle" };

export function ProfessorRowActions({
  professor,
  departments,
  subjectOptions,
  supervisorOptions,
  permissionOptions,
  initiallyOpenEdit = false,
}: {
  professor: ProfessorEditData;
  departments: { id: string; name: string; code: string }[];
  subjectOptions: { id: string; code: string; name: string; departmentName: string }[];
  supervisorOptions: { professorId: string; fullName: string; employeeCode: string; departmentName: string; subjectIds: string[] }[];
  permissionOptions: { key: string; label: string; description: string }[];
  initiallyOpenEdit?: boolean;
}) {
  const [activeState, activeAction, activating] = useActionState(
    toggleProfessorActiveAction,
    initialState,
  );
  const [deleteState, deleteAction, deleting] = useActionState(deleteProfessorAction, initialState);

  const error =
    activeState.status === "error"
      ? activeState.message
      : deleteState.status === "error"
        ? deleteState.message
        : null;

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center justify-end gap-1.5">
        <ProfessorFormDialog
          departments={departments}
          initiallyOpen={initiallyOpenEdit}
          mode="edit"
          permissionOptions={permissionOptions}
          professor={professor}
          subjectOptions={subjectOptions}
          supervisorOptions={supervisorOptions}
        />

        <form action={activeAction}>
          <input name="professorId" type="hidden" value={professor.id} />
          <input name="intent" type="hidden" value={professor.isActive ? "deactivate" : "activate"} />
          <button
            className="rounded-lg p-2 text-amber-600 transition hover:bg-amber-50 disabled:opacity-50 dark:hover:bg-amber-950/60"
            disabled={activating}
            title={professor.isActive ? "إيقاف الحساب" : "تفعيل الحساب"}
            type="submit"
          >
            {activating ? <Spinner /> : <Power aria-hidden className="size-4" />}
          </button>
        </form>

        <form
          action={deleteAction}
          onSubmit={(event) => {
            const confirmed = window.confirm(
              `سيتم حذف حساب "${professor.fullName}" نهائياً مع مواده وصلاحياته. لا يمكن الحذف إذا كان قد أنشأ أسئلة أو امتحانات أو سجلات حضور، أو إذا كان مشرفاً على أعضاء معاونة. هل تريد المتابعة؟`,
            );
            if (!confirmed) event.preventDefault();
          }}
        >
          <input name="professorId" type="hidden" value={professor.id} />
          <button
            className="rounded-lg p-2 text-rose-600 transition hover:bg-rose-50 disabled:opacity-50 dark:hover:bg-rose-950/60"
            disabled={deleting}
            title="حذف الحساب"
            type="submit"
          >
            {deleting ? <Spinner /> : <Trash2 aria-hidden className="size-4" />}
          </button>
        </form>
      </div>

      {error && (
        <p className="max-w-56 text-end text-xs font-medium text-rose-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
