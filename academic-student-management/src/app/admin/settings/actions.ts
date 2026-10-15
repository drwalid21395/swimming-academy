"use server";

import { revalidatePath } from "next/cache";
import type { ZodError } from "zod";

import {
  changePassword,
  createTerm,
  deleteTerm,
  passwordFormSchema,
  setCurrentTerm,
  termFormSchema,
  updateTerm,
  type PasswordFormValues,
  type TermFormValues,
} from "@/lib/settings";
import { requirePermission } from "@/lib/permissions";

export type SettingsActionState = {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Partial<Record<keyof TermFormValues | keyof PasswordFormValues, string>>;
  values?: Record<string, string>;
};

function failure(error: unknown, values?: Record<string, string>): SettingsActionState {
  return {
    status: "error",
    message:
      error instanceof Error ? error.message : "تعذر تنفيذ العملية. حاول مرة أخرى لاحقاً.",
    values,
  };
}

function revalidateSettingsPaths() {
  revalidatePath("/admin/settings");
  revalidatePath("/admin/subjects");
  revalidatePath("/admin");
  revalidatePath("/professor");
  revalidatePath("/student");
}

function readTermValues(formData: FormData) {
  const value = (key: string) => String(formData.get(key) ?? "").trim();
  return { name: value("name"), startDate: value("startDate"), endDate: value("endDate") };
}

function termFieldErrors(error: ZodError): SettingsActionState["fieldErrors"] {
  const fieldErrors: SettingsActionState["fieldErrors"] = {};
  for (const [key, messages] of Object.entries(error.flatten().fieldErrors)) {
    if (messages?.[0]) fieldErrors[key as keyof TermFormValues] = messages[0];
  }
  return fieldErrors;
}

export async function createTermAction(
  _prevState: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const actor = await requirePermission("settings.manage");
  const values = readTermValues(formData);
  const parsed = termFormSchema.safeParse(values);

  if (!parsed.success) {
    return {
      status: "error",
      message: "راجع بيانات الفصل الدراسي قبل الحفظ.",
      fieldErrors: termFieldErrors(parsed.error),
      values,
    };
  }

  try {
    const term = await createTerm(parsed.data, actor.id);
    revalidateSettingsPaths();
    return { status: "success", message: `تمت إضافة الفصل الدراسي: ${term.name}` };
  } catch (error) {
    return failure(error, values);
  }
}

export async function updateTermAction(
  _prevState: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const actor = await requirePermission("settings.manage");
  const termId = String(formData.get("termId") ?? "");
  const values = readTermValues(formData);
  const parsed = termFormSchema.safeParse(values);

  if (!termId) return { status: "error", message: "معرف الفصل الدراسي مفقود.", values };

  if (!parsed.success) {
    return {
      status: "error",
      message: "راجع بيانات الفصل الدراسي قبل الحفظ.",
      fieldErrors: termFieldErrors(parsed.error),
      values,
    };
  }

  try {
    await updateTerm(termId, parsed.data, actor.id);
    revalidateSettingsPaths();
    return { status: "success", message: "تم حفظ تعديلات الفصل الدراسي." };
  } catch (error) {
    return failure(error, values);
  }
}

export async function setCurrentTermAction(
  _prevState: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const actor = await requirePermission("settings.manage");
  const termId = String(formData.get("termId") ?? "");

  if (!termId) return { status: "error", message: "معرف الفصل الدراسي مفقود." };

  try {
    const term = await setCurrentTerm(termId, actor.id);
    revalidateSettingsPaths();
    return { status: "success", message: `الفصل الدراسي الحالي الآن: ${term.name}` };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteTermAction(
  _prevState: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const actor = await requirePermission("settings.manage");
  const termId = String(formData.get("termId") ?? "");

  if (!termId) return { status: "error", message: "معرف الفصل الدراسي مفقود." };

  try {
    await deleteTerm(termId, actor.id);
    revalidateSettingsPaths();
    return { status: "success", message: "تم حذف الفصل الدراسي." };
  } catch (error) {
    return failure(error);
  }
}

export async function changePasswordAction(
  _prevState: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const actor = await requirePermission("settings.manage");
  const value = (key: string) => String(formData.get(key) ?? "");
  const values = {
    currentPassword: value("currentPassword"),
    newPassword: value("newPassword"),
    confirmPassword: value("confirmPassword"),
  };
  const parsed = passwordFormSchema.safeParse(values);

  if (!parsed.success) {
    return {
      status: "error",
      message: "راجع بيانات كلمة المرور.",
      fieldErrors: termFieldErrors(parsed.error),
      values: { newPassword: "", confirmPassword: "" },
    };
  }

  try {
    await changePassword(actor.id, parsed.data);
    revalidatePath("/admin/settings");
    return { status: "success", message: "تم تغيير كلمة المرور بنجاح." };
  } catch (error) {
    return failure(error, { newPassword: "", confirmPassword: "" });
  }
}
