"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/permissions";
import {
  createSpecialization,
  deleteSpecialization,
  specializationFormSchema,
  updateSpecialization,
  type SpecializationInput,
} from "@/lib/specializations";

export type SpecializationActionState = {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Partial<Record<keyof SpecializationInput, string>>;
  values?: Record<string, string>;
};

function readValues(formData: FormData) {
  const value = (key: string) => String(formData.get(key) ?? "").trim();

  return {
    name: value("name"),
    code: value("code"),
    departmentId: value("departmentId"),
    description: value("description"),
  };
}

function toFieldErrors(flattened: Record<string, string[] | undefined>) {
  const fieldErrors: SpecializationActionState["fieldErrors"] = {};
  for (const [key, messages] of Object.entries(flattened)) {
    if (messages?.[0]) fieldErrors[key as keyof SpecializationInput] = messages[0];
  }
  return fieldErrors;
}

function revalidateSpecializationPaths() {
  revalidatePath("/admin/specializations");
  revalidatePath("/admin/students");
}

function failure(error: unknown, values?: Record<string, string>): SpecializationActionState {
  return {
    status: "error",
    message:
      error instanceof Error ? error.message : "تعذر تنفيذ العملية. حاول مرة أخرى لاحقاً.",
    values,
  };
}

export async function createSpecializationAction(
  _prevState: SpecializationActionState,
  formData: FormData,
): Promise<SpecializationActionState> {
  const actor = await requirePermission("specializations.manage");
  const values = readValues(formData);
  const parsed = specializationFormSchema.safeParse(values);

  if (!parsed.success) {
    return {
      status: "error",
      message: "راجع الحقول المطلوبة قبل الحفظ.",
      fieldErrors: toFieldErrors(parsed.error.flatten().fieldErrors),
      values,
    };
  }

  try {
    await createSpecialization(parsed.data, actor.id);
    revalidateSpecializationPaths();
    return { status: "success", message: "تمت إضافة التخصص بنجاح." };
  } catch (error) {
    return failure(error, values);
  }
}

export async function updateSpecializationAction(
  _prevState: SpecializationActionState,
  formData: FormData,
): Promise<SpecializationActionState> {
  const actor = await requirePermission("specializations.manage");
  const specializationId = String(formData.get("specializationId") ?? "");
  const values = readValues(formData);
  const parsed = specializationFormSchema.safeParse(values);

  if (!specializationId) {
    return { status: "error", message: "معرف التخصص مفقود.", values };
  }

  if (!parsed.success) {
    return {
      status: "error",
      message: "راجع الحقول المطلوبة قبل الحفظ.",
      fieldErrors: toFieldErrors(parsed.error.flatten().fieldErrors),
      values,
    };
  }

  try {
    await updateSpecialization(specializationId, parsed.data, actor.id);
    revalidateSpecializationPaths();
    return { status: "success", message: "تم تحديث التخصص بنجاح." };
  } catch (error) {
    return failure(error, values);
  }
}

export async function deleteSpecializationAction(
  _prevState: SpecializationActionState,
  formData: FormData,
): Promise<SpecializationActionState> {
  const actor = await requirePermission("specializations.delete");
  const specializationId = String(formData.get("specializationId") ?? "");

  if (!specializationId) {
    return { status: "error", message: "معرف التخصص مفقود." };
  }

  try {
    await deleteSpecialization(specializationId, actor.id);
    revalidateSpecializationPaths();
    return { status: "success", message: "تم حذف التخصص." };
  } catch (error) {
    return failure(error);
  }
}
