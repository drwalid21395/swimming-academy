"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/permissions";
import { enrollStudentsInSubjects } from "@/lib/subjects";
import {
  createStudent,
  deleteStudent,
  deleteStudents,
  deleteStudentsMatchingFilters,
  parseStudentFilters,
  setStudentActive,
  studentFormSchema,
  studentIdsMatchingFilters,
  updateStudent,
  type StudentFilters,
  type StudentInput,
} from "@/lib/students";

export type StudentActionState = {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Partial<Record<keyof StudentInput, string>>;
  values?: Record<string, string>;
  deleted?: number;
  enrolled?: number;
};

function readValues(formData: FormData) {
  const value = (key: string) => String(formData.get(key) ?? "").trim();

  return {
    fullName: value("fullName"),
    email: value("email"),
    phone: value("phone"),
    universityId: value("universityId"),
    departmentId: value("departmentId"),
    specializationId: value("specializationId"),
    academicYear: value("academicYear"),
    password: value("password"),
  };
}

function toFieldErrors(flattened: Record<string, string[] | undefined>) {
  const fieldErrors: StudentActionState["fieldErrors"] = {};
  for (const [key, messages] of Object.entries(flattened)) {
    if (messages?.[0]) fieldErrors[key as keyof StudentInput] = messages[0];
  }
  return fieldErrors;
}

function revalidateStudentPaths(studentId?: string) {
  revalidatePath("/admin/students");
  if (studentId) revalidatePath(`/admin/students/${studentId}`);
}

function failure(error: unknown, values?: Record<string, string>): StudentActionState {
  const message =
    error instanceof Error ? error.message : "تعذر تنفيذ العملية. حاول مرة أخرى لاحقاً.";

  return {
    status: "error",
    message,
    values,
  };
}

export async function createStudentAction(
  _prevState: StudentActionState,
  formData: FormData,
): Promise<StudentActionState> {
  const actor = await requirePermission("students.manage");
  const values = readValues(formData);
  const parsed = studentFormSchema.safeParse(values);

  if (!parsed.success) {
    return {
      status: "error",
      message: "راجع الحقول المطلوبة قبل الحفظ.",
      fieldErrors: toFieldErrors(parsed.error.flatten().fieldErrors),
      values,
    };
  }

  try {
    const student = await createStudent(parsed.data, actor.id);
    revalidateStudentPaths(student.id);
    return { status: "success", message: "تمت إضافة الطالب بنجاح." };
  } catch (error) {
    return failure(error, values);
  }
}

export async function updateStudentAction(
  _prevState: StudentActionState,
  formData: FormData,
): Promise<StudentActionState> {
  const actor = await requirePermission("students.manage");
  const studentId = String(formData.get("studentId") ?? "");
  const values = readValues(formData);
  const parsed = studentFormSchema.safeParse(values);

  if (!studentId) return { status: "error", message: "معرف الطالب مفقود.", values };

  if (!parsed.success) {
    return {
      status: "error",
      message: "راجع الحقول المطلوبة قبل الحفظ.",
      fieldErrors: toFieldErrors(parsed.error.flatten().fieldErrors),
      values,
    };
  }

  try {
    await updateStudent(studentId, parsed.data, actor.id);
    revalidateStudentPaths(studentId);
    return { status: "success", message: "تم تحديث بيانات الطالب بنجاح." };
  } catch (error) {
    return failure(error, values);
  }
}

export async function deleteStudentAction(
  _prevState: StudentActionState,
  formData: FormData,
): Promise<StudentActionState> {
  const actor = await requirePermission("students.delete");
  const studentId = String(formData.get("studentId") ?? "");

  if (!studentId) return { status: "error", message: "معرف الطالب مفقود." };

  try {
    await deleteStudent(studentId, actor.id);
    revalidateStudentPaths(studentId);
    return { status: "success", message: "تم حذف الطالب." };
  } catch (error) {
    return failure(error);
  }
}

/**
 * Bulk delete from the students table. `scope=selected` removes the ticked rows,
 * `scope=filtered` removes everything the current filters resolve to. The
 * filters are re-read and re-evaluated on the server, so a tampered form can
 * never reach students outside what an admin could already list and delete.
 */
export async function deleteStudentsAction(
  _prevState: StudentActionState,
  formData: FormData,
): Promise<StudentActionState> {
  const actor = await requirePermission("students.delete");

  if (formData.get("confirm") !== "yes") {
    return { status: "error", message: "لم يتم تأكيد الحذف." };
  }

  const scope = String(formData.get("scope") ?? "selected");

  try {
    const result =
      scope === "filtered"
        ? await deleteStudentsMatchingFilters(
            parseStudentFilters({
              query: String(formData.get("query") ?? "") || undefined,
              departmentId: String(formData.get("departmentId") ?? "") || undefined,
              academicYear: String(formData.get("academicYear") ?? "") || undefined,
              attendanceState: (String(formData.get("attendanceState") ?? "all") ||
                "all") as StudentFilters["attendanceState"],
            }),
            actor.id,
          )
        : await deleteStudents(
            formData.getAll("studentIds").map((value) => String(value)),
            actor.id,
          );

    revalidateStudentPaths();
    return {
      status: "success",
      deleted: result.deleted,
      message:
        result.deleted > 0
          ? `تم حذف ${result.deleted} طالب نهائياً.`
          : "لا يوجد طلاب مطابقون للحذف.",
    };
  } catch (error) {
    return failure(error);
  }
}

/**
 * Bulk enrolment from the students table. `scope=selected` registers the ticked
 * rows, `scope=filtered` everything the current filters resolve to; the filters
 * are re-read and re-evaluated on the server, so a tampered form cannot reach
 * students the admin could not already list. `allSubjects=yes` ignores the
 * ticked subjects and registers into every subject in the system.
 */
export async function enrollSelectedStudentsAction(
  _prevState: StudentActionState,
  formData: FormData,
): Promise<StudentActionState> {
  const actor = await requirePermission("subjects.manage");

  const scope = String(formData.get("scope") ?? "selected");
  const allSubjects = formData.get("allSubjects") === "yes";
  const subjectIds = formData.getAll("subjectIds").map((value) => String(value));

  if (!allSubjects && subjectIds.length === 0) {
    return { status: "error", message: "اختر مادة واحدة على الأقل، أو حدّد «كل المواد»." };
  }

  try {
    const studentIds =
      scope === "filtered"
        ? await studentIdsMatchingFilters(
            parseStudentFilters({
              query: String(formData.get("query") ?? "") || undefined,
              departmentId: String(formData.get("departmentId") ?? "") || undefined,
              academicYear: String(formData.get("academicYear") ?? "") || undefined,
              attendanceState: (String(formData.get("attendanceState") ?? "all") ||
                "all") as StudentFilters["attendanceState"],
            }),
          )
        : formData.getAll("studentIds").map((value) => String(value));

    const result = await enrollStudentsInSubjects({ studentIds, subjectIds, allSubjects, actorId: actor.id });

    revalidatePath("/admin/students");
    revalidatePath("/admin/subjects");

    const detail = [
      `تسجيل جديد: ${result.enrolled}`,
      result.reactivated > 0 ? `إعادة تفعيل: ${result.reactivated}` : null,
      result.alreadyActive > 0 ? `مسجلون بالفعل: ${result.alreadyActive}` : null,
    ]
      .filter(Boolean)
      .join("، ");

    return {
      status: "success",
      enrolled: result.enrolled,
      message:
        result.enrolled + result.reactivated === 0
          ? `الطلاب المحددون مسجلون بالفعل في كل المواد المختارة.`
          : `تمت إضافة ${result.students} طالب إلى ${result.subjects} مادة (${detail}).`,
    };
  } catch (error) {
    return failure(error);
  }
}

export async function setStudentActiveAction(
  _prevState: StudentActionState,
  formData: FormData,
): Promise<StudentActionState> {
  const actor = await requirePermission("students.manage");
  const studentId = String(formData.get("studentId") ?? "");
  const isActive = String(formData.get("isActive")) === "true";

  if (!studentId) return { status: "error", message: "معرف الطالب مفقود." };

  try {
    await setStudentActive(studentId, isActive, actor.id);
    revalidateStudentPaths(studentId);
    return {
      status: "success",
      message: isActive ? "تم تفعيل حساب الطالب." : "تم إيقاف حساب الطالب.",
    };
  } catch (error) {
    return failure(error);
  }
}
