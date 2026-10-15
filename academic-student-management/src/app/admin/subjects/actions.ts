"use server";

import { revalidatePath } from "next/cache";

import {
  createDepartment,
  deleteDepartment,
  departmentFormSchema,
  updateDepartment,
  type DepartmentFormValues,
} from "@/lib/departments";
import { formatNumber } from "@/lib/format";
import { requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { loadProfessorScope, assertProfessorGrant } from "@/lib/professor-auth";
import {
  createSubject,
  deleteSubject,
  enrollStudents,
  subjectFormSchema,
  unenrollStudent,
  updateSubject,
  type SubjectFormValues,
} from "@/lib/subjects";

export type SubjectActionState = {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Partial<Record<keyof SubjectFormValues, string>>;
  values?: Record<string, string>;
};

function readValues(formData: FormData) {
  const value = (key: string) => String(formData.get(key) ?? "").trim();

  return {
    code: value("code"),
    name: value("name"),
    description: value("description"),
    creditHours: value("creditHours"),
    attendanceLimit: value("attendanceLimit"),
    departmentId: value("departmentId"),
    academicTermId: value("academicTermId"),
    professorId: value("professorId"),
  };
}

function toFieldErrors(flattened: Record<string, string[] | undefined>) {
  const fieldErrors: SubjectActionState["fieldErrors"] = {};
  for (const [key, messages] of Object.entries(flattened)) {
    if (messages?.[0]) fieldErrors[key as keyof SubjectFormValues] = messages[0];
  }
  return fieldErrors;
}

function failure(error: unknown, values?: Record<string, string>): SubjectActionState {
  return {
    status: "error",
    message: error instanceof Error ? error.message : "تعذر تنفيذ العملية. حاول مرة أخرى لاحقاً.",
    values,
  };
}

function revalidateSubjectPaths(subjectId?: string) {
  revalidatePath("/admin/subjects");
  if (subjectId) revalidatePath(`/admin/subjects/${subjectId}`);
}

/** Professors may only touch their own subjects, and never re-assign ownership. */
async function assertSubjectWriteAccess(actor: { id: string; role: string }, subjectId: string) {
  if (actor.role !== "PROFESSOR") return;

  await assertProfessorGrant(actor.id, "SUBJECTS_MANAGE");

  const scope = await loadProfessorScope(actor.id);
  if (!scope) throw new Error("ملف عضو هيئة التدريس غير موجود.");
  if (!scope.subjectIds.includes(subjectId)) {
    throw new Error("لا تملك صلاحية تعديل هذه المادة.");
  }
}

/**
 * A professor creating a subject is confined to their own department and becomes
 * the assigned professor, so the form cannot be used to plant a subject in another
 * department or to hand it to a colleague.
 */
async function pinProfessorOwnedSubject<T extends { departmentId: string; professorId: string }>(
  actor: { id: string; role: string },
  data: T,
): Promise<T> {
  if (actor.role !== "PROFESSOR") return data;

  await assertProfessorGrant(actor.id, "SUBJECTS_MANAGE");

  const professor = await prisma.professor.findUnique({
    where: { userId: actor.id },
    select: { id: true, departmentId: true },
  });

  if (!professor) throw new Error("ملف عضو هيئة التدريس غير موجود.");

  return { ...data, departmentId: professor.departmentId, professorId: professor.id };
}

export async function createSubjectAction(
  _prevState: SubjectActionState,
  formData: FormData,
): Promise<SubjectActionState> {
  const actor = await requirePermission("subjects.manage");
  const values = readValues(formData);
  const parsed = subjectFormSchema.safeParse(values);

  if (!parsed.success) {
    return {
      status: "error",
      message: "راجع الحقول المطلوبة قبل الحفظ.",
      fieldErrors: toFieldErrors(parsed.error.flatten().fieldErrors),
      values,
    };
  }

  try {
    const data = await pinProfessorOwnedSubject(actor, parsed.data);
    const subject = await createSubject(data, actor.id);
    revalidateSubjectPaths(subject.id);
    return { status: "success", message: `تمت إضافة المادة ${subject.name} بنجاح.` };
  } catch (error) {
    return failure(error, values);
  }
}

export async function updateSubjectAction(
  _prevState: SubjectActionState,
  formData: FormData,
): Promise<SubjectActionState> {
  const actor = await requirePermission("subjects.manage");
  const subjectId = String(formData.get("subjectId") ?? "");
  const values = readValues(formData);
  const parsed = subjectFormSchema.safeParse(values);

  if (!subjectId) return { status: "error", message: "معرف المادة مفقود.", values };

  if (!parsed.success) {
    return {
      status: "error",
      message: "راجع الحقول المطلوبة قبل الحفظ.",
      fieldErrors: toFieldErrors(parsed.error.flatten().fieldErrors),
      values,
    };
  }

  try {
    await assertSubjectWriteAccess(actor, subjectId);

    const data = await pinProfessorOwnedSubject(actor, parsed.data);
    await updateSubject(subjectId, data, actor.id);
    revalidateSubjectPaths(subjectId);
    return { status: "success", message: "تم تحديث بيانات المادة بنجاح." };
  } catch (error) {
    return failure(error, values);
  }
}

export async function deleteSubjectAction(
  _prevState: SubjectActionState,
  formData: FormData,
): Promise<SubjectActionState> {
  const actor = await requirePermission("subjects.delete");
  const subjectId = String(formData.get("subjectId") ?? "");

  if (!subjectId) return { status: "error", message: "معرف المادة مفقود." };

  try {
    await deleteSubject(subjectId, actor.id);
    revalidateSubjectPaths(subjectId);
    return { status: "success", message: "تم حذف المادة وكل سجلاتها." };
  } catch (error) {
    return failure(error);
  }
}

export async function enrollStudentsAction(
  _prevState: SubjectActionState,
  formData: FormData,
): Promise<SubjectActionState> {
  const actor = await requirePermission("subjects.manage");
  const subjectId = String(formData.get("subjectId") ?? "");
  const studentIds = formData.getAll("studentId").map(String).filter(Boolean);

  if (!subjectId) return { status: "error", message: "معرف المادة مفقود." };

  try {
    await assertSubjectWriteAccess(actor, subjectId);

    const result = await enrollStudents(subjectId, studentIds, actor.id);
    revalidateSubjectPaths(subjectId);
    return {
      status: "success",
      message:
        result.skipped > 0
          ? `تمت إضافة ${result.added} طالب، وتجاهل ${result.skipped} طالب مسجل مسبقاً.`
          : `تمت إضافة ${result.added} طالب إلى المادة.`,
    };
  } catch (error) {
    return failure(error);
  }
}

export async function unenrollStudentAction(
  _prevState: SubjectActionState,
  formData: FormData,
): Promise<SubjectActionState> {
  const actor = await requirePermission("subjects.manage");
  const subjectId = String(formData.get("subjectId") ?? "");
  const studentId = String(formData.get("studentId") ?? "");

  if (!subjectId || !studentId) return { status: "error", message: "بيانات غير كاملة." };

  try {
    await assertSubjectWriteAccess(actor, subjectId);

    await unenrollStudent(subjectId, studentId, actor.id);
    revalidateSubjectPaths(subjectId);
    return { status: "success", message: "تم إلغاء تسجيل الطالب من المادة." };
  } catch (error) {
    return failure(error);
  }
}

/**
 * Unenrolls every ticked student from one subject.
 *
 * Used by the roster table on the subject page. The ids arrive as a repeated
 * field, the same way the single-student version reads one, and the whole batch
 * is checked against the same write access before anything is removed, so a
 * tampered form cannot reach a subject the actor could not edit row by row.
 */
export async function unenrollStudentsAction(
  _prevState: SubjectActionState,
  formData: FormData,
): Promise<SubjectActionState> {
  const actor = await requirePermission("subjects.manage");
  const subjectId = String(formData.get("subjectId") ?? "");
  const studentIds = [...new Set(formData.getAll("studentId").map(String).filter(Boolean))];

  if (!subjectId || studentIds.length === 0) {
    return { status: "error", message: "لم يتم تحديد أي طالب." };
  }

  try {
    await assertSubjectWriteAccess(actor, subjectId);

    for (const studentId of studentIds) {
      await unenrollStudent(subjectId, studentId, actor.id);
    }

    revalidateSubjectPaths(subjectId);
    return {
      status: "success",
      message: `تم إلغاء تسجيل ${formatNumber(studentIds.length)} طالب من المادة.`,
    };
  } catch (error) {
    return failure(error);
  }
}

export type DepartmentActionState = {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Partial<Record<keyof DepartmentFormValues, string>>;
  values?: Record<string, string>;
};

function departmentFailure(error: unknown, values?: Record<string, string>): DepartmentActionState {
  return {
    status: "error",
    message: error instanceof Error ? error.message : "تعذر تنفيذ العملية. حاول مرة أخرى لاحقاً.",
    values,
  };
}

function departmentFieldErrors(flattened: Record<string, string[] | undefined>) {
  const fieldErrors: DepartmentActionState["fieldErrors"] = {};
  for (const [key, messages] of Object.entries(flattened)) {
    if (messages?.[0]) fieldErrors[key as keyof DepartmentFormValues] = messages[0];
  }
  return fieldErrors;
}

function readDepartmentValues(formData: FormData) {
  const value = (key: string) => String(formData.get(key) ?? "").trim();

  return {
    name: value("name"),
    code: value("code"),
    description: value("description"),
    headId: value("headId"),
  };
}

function revalidateDepartmentPaths(departmentId?: string) {
  revalidatePath("/admin/subjects");
  revalidatePath("/admin/settings");
  if (departmentId) revalidatePath(`/admin/subjects?departmentId=${departmentId}`);
}

export async function createDepartmentAction(
  _prevState: DepartmentActionState,
  formData: FormData,
): Promise<DepartmentActionState> {
  const actor = await requirePermission("subjects.manage");
  const values = readDepartmentValues(formData);
  const parsed = departmentFormSchema.safeParse(values);

  if (!parsed.success) {
    return {
      status: "error",
      message: "راجع الحقول المطلوبة قبل الحفظ.",
      fieldErrors: departmentFieldErrors(parsed.error.flatten().fieldErrors),
      values,
    };
  }

  try {
    const department = await createDepartment(parsed.data, actor.id);
    revalidateDepartmentPaths(department.id);
    return { status: "success", message: `تمت إضافة قسم ${department.name} بنجاح.` };
  } catch (error) {
    return departmentFailure(error, values);
  }
}

export async function updateDepartmentAction(
  _prevState: DepartmentActionState,
  formData: FormData,
): Promise<DepartmentActionState> {
  const actor = await requirePermission("subjects.manage");
  const departmentId = String(formData.get("departmentId") ?? "");
  const values = readDepartmentValues(formData);
  const parsed = departmentFormSchema.safeParse(values);

  if (!departmentId) {
    return { status: "error", message: "معرف القسم مفقود.", values };
  }

  if (!parsed.success) {
    return {
      status: "error",
      message: "راجع الحقول المطلوبة قبل الحفظ.",
      fieldErrors: departmentFieldErrors(parsed.error.flatten().fieldErrors),
      values,
    };
  }

  try {
    await updateDepartment(departmentId, parsed.data, actor.id);
    revalidateDepartmentPaths(departmentId);
    return { status: "success", message: "تم تحديث القسم ورئيسه بنجاح." };
  } catch (error) {
    return departmentFailure(error, values);
  }
}

export async function deleteDepartmentAction(
  _prevState: DepartmentActionState,
  formData: FormData,
): Promise<DepartmentActionState> {
  const actor = await requirePermission("subjects.manage");
  const departmentId = String(formData.get("departmentId") ?? "");

  if (!departmentId) return { status: "error", message: "معرف القسم مفقود." };

  try {
    await deleteDepartment(departmentId, actor.id);
    revalidateDepartmentPaths(departmentId);
    return { status: "success", message: "تم حذف القسم." };
  } catch (error) {
    return departmentFailure(error);
  }
}
