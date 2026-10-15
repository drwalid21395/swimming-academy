"use server";

import { revalidatePath } from "next/cache";

import {
  announcementFormSchema,
  createAnnouncement,
  deleteAnnouncement,
  updateAnnouncement,
  type AnnouncementFormValues,
} from "@/lib/announcements";
import { prisma } from "@/lib/prisma";
import { assertProfessorGrant, loadProfessorScope } from "@/lib/professor-auth";
import { requirePermission } from "@/lib/permissions";

export type AnnouncementActionState = {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Partial<Record<keyof AnnouncementFormValues, string>>;
  values?: Record<string, string | boolean>;
};

function failure(error: unknown, values?: Record<string, string | boolean>): AnnouncementActionState {
  return {
    status: "error",
    message:
      error instanceof Error ? error.message : "تعذر تنفيذ العملية. حاول مرة أخرى لاحقاً.",
    values,
  };
}

function readAnnouncementValues(formData: FormData) {
  const value = (key: string) => String(formData.get(key) ?? "").trim();

  return {
    subjectId: value("subjectId"),
    title: value("title"),
    content: value("content"),
    isPinned: formData.get("isPinned") === "true",
    publishAt: value("publishAt"),
  };
}

function revalidateAnnouncementPaths() {
  revalidatePath("/admin/announcements");
  revalidatePath("/professor/announcements");
  revalidatePath("/student/news");
  revalidatePath("/admin");
  revalidatePath("/professor");
  revalidatePath("/student");
}

/** Professors need the granted capability and may only publish inside their subjects. */
async function scopeFor(actor: { id: string; role: string }) {
  if (actor.role !== "PROFESSOR") return undefined;

  await assertProfessorGrant(actor.id, "ANNOUNCEMENTS_PUBLISH");

  // `loadProfessorScope` resolves the inherited scope, so an assistant publishes
  // across the supervisor's subjects without those being assigned one by one.
  const scope = await loadProfessorScope(actor.id);

  if (!scope) throw new Error("ملف عضو هيئة التدريس غير موجود.");

  return { subjectIds: scope.subjectIds };
}

export async function createAnnouncementAction(
  _prevState: AnnouncementActionState,
  formData: FormData,
): Promise<AnnouncementActionState> {
  const actor = await requirePermission("announcements.manage");
  const values = readAnnouncementValues(formData);
  const parsed = announcementFormSchema.safeParse(values);

  if (!parsed.success) {
    const flattened = parsed.error.flatten().fieldErrors;
    const fieldErrors: AnnouncementActionState["fieldErrors"] = {};

    for (const [key, messages] of Object.entries(flattened)) {
      if (messages?.[0]) fieldErrors[key as keyof AnnouncementFormValues] = messages[0];
    }

    return { status: "error", message: "راجع الحقول المطلوبة قبل الحفظ.", fieldErrors, values };
  }

  try {
    await createAnnouncement(parsed.data, actor.id, await scopeFor(actor));
    revalidateAnnouncementPaths();
    return { status: "success", message: "تم نشر الإعلان بنجاح." };
  } catch (error) {
    return failure(error, values);
  }
}

export async function updateAnnouncementAction(
  _prevState: AnnouncementActionState,
  formData: FormData,
): Promise<AnnouncementActionState> {
  const actor = await requirePermission("announcements.manage");
  const announcementId = String(formData.get("announcementId") ?? "");
  const values = readAnnouncementValues(formData);
  const parsed = announcementFormSchema.safeParse(values);

  if (!announcementId) return { status: "error", message: "معرف الإعلان مفقود.", values };

  if (!parsed.success) {
    const flattened = parsed.error.flatten().fieldErrors;
    const fieldErrors: AnnouncementActionState["fieldErrors"] = {};

    for (const [key, messages] of Object.entries(flattened)) {
      if (messages?.[0]) fieldErrors[key as keyof AnnouncementFormValues] = messages[0];
    }

    return { status: "error", message: "راجع الحقول المطلوبة قبل الحفظ.", fieldErrors, values };
  }

  try {
    await updateAnnouncement(announcementId, parsed.data, actor.id, await scopeFor(actor));
    revalidateAnnouncementPaths();
    return { status: "success", message: "تم تحديث الإعلان بنجاح." };
  } catch (error) {
    return failure(error, values);
  }
}

export async function toggleAnnouncementPinAction(
  _prevState: AnnouncementActionState,
  formData: FormData,
): Promise<AnnouncementActionState> {
  const actor = await requirePermission("announcements.manage");
  const announcementId = String(formData.get("announcementId") ?? "");

  if (!announcementId) return { status: "error", message: "معرف الإعلان مفقود." };

  try {
    const existing = await prisma.announcement.findUnique({
      where: { id: announcementId },
      select: { id: true, title: true, isPinned: true, subjectId: true },
    });
    if (!existing) throw new Error("الإعلان غير موجود.");

    const scope = await scopeFor(actor);
    if (scope && !scope.subjectIds.includes(existing.subjectId)) {
      throw new Error("لا تملك صلاحية تعديل إعلانات هذه المادة.");
    }

    await prisma.announcement.update({
      where: { id: announcementId },
      data: { isPinned: !existing.isPinned },
      select: { id: true },
    });

    revalidateAnnouncementPaths();
    return {
      status: "success",
      message: existing.isPinned ? "تم إلغاء تثبيت الإعلان." : "تم تثبيت الإعلان في الأعلى.",
    };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteAnnouncementAction(
  _prevState: AnnouncementActionState,
  formData: FormData,
): Promise<AnnouncementActionState> {
  const actor = await requirePermission("announcements.delete");
  const announcementId = String(formData.get("announcementId") ?? "");

  if (!announcementId) return { status: "error", message: "معرف الإعلان مفقود." };

  try {
    await deleteAnnouncement(announcementId, actor.id);
    revalidateAnnouncementPaths();
    return { status: "success", message: "تم حذف الإعلان." };
  } catch (error) {
    return failure(error);
  }
}
