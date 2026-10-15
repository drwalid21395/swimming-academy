"use client";

import { Pin, PinOff, Trash2 } from "lucide-react";
import { useActionState } from "react";

import { Spinner } from "@/components/ui/loading";

import {
  deleteAnnouncementAction,
  toggleAnnouncementPinAction,
  type AnnouncementActionState,
} from "./actions";

const initialState: AnnouncementActionState = { status: "idle" };

export function AnnouncementRowActions({
  announcementId,
  title,
  isPinned,
  canManage,
  canDelete,
}: {
  announcementId: string;
  title: string;
  isPinned: boolean;
  canManage: boolean;
  canDelete: boolean;
}) {
  const [pinState, pinAction, pinning] = useActionState(
    toggleAnnouncementPinAction,
    initialState,
  );
  const [deleteState, deleteAction, deleting] = useActionState(
    deleteAnnouncementAction,
    initialState,
  );

  const error =
    pinState.status === "error"
      ? pinState.message
      : deleteState.status === "error"
        ? deleteState.message
        : null;

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center justify-end gap-1.5">
        {canManage && (
          <form action={pinAction}>
            <input name="announcementId" type="hidden" value={announcementId} />
            <button
              className="rounded-lg p-2 text-amber-600 transition hover:bg-amber-50 disabled:opacity-50 dark:hover:bg-amber-950/60"
              disabled={pinning}
              title={isPinned ? "إلغاء تثبيت الإعلان" : "تثبيت الإعلان في الأعلى"}
              type="submit"
            >
              {pinning ? (
                <Spinner />
              ) : isPinned ? (
                <PinOff aria-hidden className="size-4" />
              ) : (
                <Pin aria-hidden className="size-4" />
              )}
            </button>
          </form>
        )}

        {canDelete && (
          <form
            action={deleteAction}
            onSubmit={(event) => {
              const confirmed = window.confirm(
                `سيتم حذف الإعلان "${title}" نهائياً ولن يظهر للطلاب بعد الآن. هل تريد المتابعة؟`,
              );
              if (!confirmed) event.preventDefault();
            }}
          >
            <input name="announcementId" type="hidden" value={announcementId} />
            <button
              className="rounded-lg p-2 text-rose-600 transition hover:bg-rose-50 disabled:opacity-50 dark:hover:bg-rose-950/60"
              disabled={deleting}
              title="حذف الإعلان"
              type="submit"
            >
              {deleting ? <Spinner /> : <Trash2 aria-hidden className="size-4" />}
            </button>
          </form>
        )}
      </div>

      {error && (
        <p className="max-w-48 text-end text-xs font-medium text-rose-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
