"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/permissions";
import { isProfessorPermissionKey, setProfessorPermission, setProfessorSubjectScope } from "@/lib/professor-permissions";
import {
  createProfessorAccount,
  deleteProfessorAccount,
  professorFormSchema,
  setProfessorActive,
  updateProfessorAccount,
  type ProfessorFormValues,
  type ProfessorInput,
} from "@/lib/professors";

export type ProfessorPermissionActionState = {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Partial<Record<keyof ProfessorInput, string>>;
  values?: Record<string, string>;
};

function failure(error: unknown): ProfessorPermissionActionState {
  return {
    status: "error",
    message: error instanceof Error ? error.message : "تعذر تنفيذ العملية. حاول مرة أخرى لاحقاً.",
  };
}

function readProfessorValues(formData: FormData) {
  const value = (key: string) => String(formData.get(key) ?? "").trim();

  return {
    fullName: value("fullName"),
    email: value("email"),
    employeeCode: value("employeeCode"),
    phone: value("phone"),
    departmentId: value("departmentId"),
    password: value("password"),
    kind: value("kind") === "ASSISTANT" ? ("ASSISTANT" as const) : ("PROFESSOR" as const),
    supervisorId: value("supervisorId"),
    isActive: value("isActive") === "0" ? ("0" as const) : ("1" as const),
    subjectIds: formData.getAll("subjectIds").map(String).filter(Boolean),
    permissionKeys: formData.getAll("permissionKeys").map(String).filter(Boolean),
  };
}

function toFieldErrors(flattened: Record<string, string[] | undefined>) {
  const fieldErrors: ProfessorPermissionActionState["fieldErrors"] = {};
  for (const [key, messages] of Object.entries(flattened)) {
    if (messages?.[0]) fieldErrors[key as keyof ProfessorInput] = messages[0];
  }
  return fieldErrors;
}

function revalidateProfessorPaths() {
  revalidatePath("/admin/professor-permissions");
  revalidatePath("/admin/audit-log");
  revalidatePath("/admin");
}

/** Echoes the submitted account fields back to the form; the password is never echoed. */
function echoValues(values: ReturnType<typeof readProfessorValues>): Record<string, string> {
  return {
    fullName: values.fullName,
    email: values.email,
    employeeCode: values.employeeCode,
    phone: values.phone,
    departmentId: values.departmentId,
    kind: values.kind,
    supervisorId: values.supervisorId,
    password: "",
  };
}

/** Assistants are teaching staff too, so the wording follows the account kind. */
function memberNoun(kind: ProfessorFormValues["kind"]) {
  return kind === "ASSISTANT" ? "عضو هيئة المعاونة" : "الدكتور";
}

/** Only administrators may grant or revoke a professor capability. */
export async function toggleProfessorPermissionAction(
  _prevState: ProfessorPermissionActionState,
  formData: FormData,
): Promise<ProfessorPermissionActionState> {
  const actor = await requirePermission("professors.permissions");

  const professorId = String(formData.get("professorId") ?? "").trim();
  const permission = String(formData.get("permission") ?? "").trim();
  const granted = formData.get("intent") === "grant";

  if (!professorId) return { status: "error", message: "معرف عضو هيئة التدريس مفقود." };
  if (!isProfessorPermissionKey(permission)) {
    return { status: "error", message: "نوع الصلاحية غير معروف." };
  }

  try {
    const result = await setProfessorPermission({ professorId, permission, granted }, actor.id);
    revalidatePath("/admin/professor-permissions");
    revalidatePath("/admin/audit-log");

    if (result.alreadyAssigned) {
      return { status: "success", message: "الصلاحية ممنوحة مسبقاً، لم يتغيّر شيء." };
    }

    return {
      status: "success",
      message: granted ? "تم منح الصلاحية بنجاح." : "تم سحب الصلاحية بنجاح.",
    };
  } catch (error) {
    return failure(error);
  }
}

/** Replaces the subject scope that limits every professor page. */
export async function saveProfessorScopeAction(
  _prevState: ProfessorPermissionActionState,
  formData: FormData,
): Promise<ProfessorPermissionActionState> {
  const actor = await requirePermission("professors.permissions");

  const professorId = String(formData.get("professorId") ?? "").trim();
  const subjectIds = formData.getAll("subjectIds").map(String).filter(Boolean);

  if (!professorId) return { status: "error", message: "معرف عضو هيئة التدريس مفقود." };

  try {
    const professor = await prisma.professor.findUnique({
      where: { id: professorId },
      select: { user: { select: { fullName: true } } },
    });
    if (!professor) throw new Error("عضو هيئة التدريس غير موجود.");

    const result = await setProfessorSubjectScope(professorId, subjectIds, actor.id);
    revalidatePath("/admin/professor-permissions");
    revalidatePath("/admin/audit-log");

    if (!result.changed) {
      return { status: "success", message: "نطاق المواد لم يتغيّر." };
    }

    return {
      status: "success",
      message: `تم تحديث نطاق المواد (${result.added} مضافة، ${result.removed} مسحوبة).`,
    };
  } catch (error) {
    return failure(error);
  }
}

/** Creates a professor together with his account, subject scope and granted capabilities. */
export async function createProfessorAction(
  _prevState: ProfessorPermissionActionState,
  formData: FormData,
): Promise<ProfessorPermissionActionState> {
  const actor = await requirePermission("professors.permissions");
  const values = readProfessorValues(formData);
  const parsed = professorFormSchema.safeParse(values);

  if (!parsed.success) {
    return {
      status: "error",
      message: `راجع بيانات ${memberNoun(values.kind)} قبل الحفظ.`,
      fieldErrors: toFieldErrors(parsed.error.flatten().fieldErrors),
      values: echoValues(values),
    };
  }

  if (parsed.data.permissionKeys.some((key) => !isProfessorPermissionKey(key))) {
    return { status: "error", message: "إحدى الصلاحيات المحددة غير معروفة." };
  }

  try {
    await createProfessorAccount(parsed.data, actor.id, {
      primarySubjectId: String(formData.get("primarySubjectId") ?? ""),
    });
    revalidateProfessorPaths();

    return {
      status: "success",
      message: `تمت إضافة ${memberNoun(values.kind)} ${values.fullName}، ويمكنه الدخول بـ ${values.email}.`,
    };
  } catch (error) {
    return failure(error);
  }
}

/** Updates account details, subject scope and capabilities of an existing professor. */
export async function updateProfessorAction(
  _prevState: ProfessorPermissionActionState,
  formData: FormData,
): Promise<ProfessorPermissionActionState> {
  const actor = await requirePermission("professors.permissions");
  const professorId = String(formData.get("professorId") ?? "").trim();
  const values = readProfessorValues(formData);
  const parsed = professorFormSchema.safeParse(values);

  if (!professorId) return { status: "error", message: "معرف عضو هيئة التدريس مفقود." };

  if (!parsed.success) {
    return {
      status: "error",
      message: `راجع بيانات ${memberNoun(values.kind)} قبل الحفظ.`,
      fieldErrors: toFieldErrors(parsed.error.flatten().fieldErrors),
      values: echoValues(values),
    };
  }

  if (parsed.data.permissionKeys.some((key) => !isProfessorPermissionKey(key))) {
    return { status: "error", message: "إحدى الصلاحيات المحددة غير معروفة." };
  }

  try {
    const result = await updateProfessorAccount(professorId, parsed.data, actor.id, {
      primarySubjectId: String(formData.get("primarySubjectId") ?? ""),
    });
    revalidateProfessorPaths();

    const parts = [
      `${result.granted} صلاحية ممنوحة`,
      `${result.revoked} صلاحية مسحوبة`,
      `${result.subjectsAdded} مادة مضافة`,
      `${result.subjectsRemoved} مادة مسحوبة`,
    ];
    if (result.passwordChanged) parts.push("تم تغيير كلمة المرور");

    return {
      status: "success",
      message: `تم حفظ بيانات ${memberNoun(values.kind)} (${parts.join("، ")}).`,
    };
  } catch (error) {
    return failure(error);
  }
}

/** Stops or resumes a professor login. */
export async function toggleProfessorActiveAction(
  _prevState: ProfessorPermissionActionState,
  formData: FormData,
): Promise<ProfessorPermissionActionState> {
  const actor = await requirePermission("professors.permissions");
  const professorId = String(formData.get("professorId") ?? "").trim();
  const activate = formData.get("intent") === "activate";

  if (!professorId) return { status: "error", message: "معرف عضو هيئة التدريس مفقود." };

  try {
    const result = await setProfessorActive(professorId, activate, actor.id);
    revalidateProfessorPaths();

    if (!result.changed) {
      return { status: "success", message: "حالة الحساب لم تتغيّر." };
    }

    return {
      status: "success",
      message: activate ? "تم تفعيل الحساب." : "تم إيقاف الحساب، لن يستطيع الدخول.",
    };
  } catch (error) {
    return failure(error);
  }
}

/** Removes a professor account that has no produced records. */
export async function deleteProfessorAction(
  _prevState: ProfessorPermissionActionState,
  formData: FormData,
): Promise<ProfessorPermissionActionState> {
  const actor = await requirePermission("professors.permissions");
  const professorId = String(formData.get("professorId") ?? "").trim();

  if (!professorId) return { status: "error", message: "معرف عضو هيئة التدريس مفقود." };

  try {
    await deleteProfessorAccount(professorId, actor.id);
    revalidateProfessorPaths();
    return { status: "success", message: "تم حذف حساب الدكتور." };
  } catch (error) {
    return failure(error);
  }
}
