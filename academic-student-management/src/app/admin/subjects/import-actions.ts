"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/permissions";
import {
  importStudentsForSubjectFromExcel,
  type SubjectImportFeedback,
} from "@/lib/student-import";

export async function importStudentsForSubjectExcelAction(
  formData: FormData,
): Promise<SubjectImportFeedback> {
  const actor = await requirePermission("subjects.manage");
  const subjectId = String(formData.get("subjectId") ?? "");
  const file = formData.get("file");

  if (!subjectId) {
    return {
      status: "error",
      message: "معرف المادة مفقود.",
      created: 0,
      updated: 0,
      enrolled: 0,
      alreadyEnrolled: 0,
      subjectCode: "",
      errors: [],
    };
  }
  if (!(file instanceof File) || file.size === 0) {
    return {
      status: "error",
      message: "اختر ملف إكسل أولاً.",
      created: 0,
      updated: 0,
      enrolled: 0,
      alreadyEnrolled: 0,
      subjectCode: "",
      errors: [],
    };
  }
  if (!/\.(xlsx|xls)$/i.test(file.name)) {
    return {
      status: "error",
      message: "الملف يجب أن يكون بصيغة إكسل (xlsx أو xls).",
      created: 0,
      updated: 0,
      enrolled: 0,
      alreadyEnrolled: 0,
      subjectCode: "",
      errors: [],
    };
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await importStudentsForSubjectFromExcel(buffer, subjectId, actor.id);

    revalidatePath("/admin/subjects");
    revalidatePath(`/admin/subjects/${subjectId}`);

    const ok = result.errors.length === 0;
    const message = ok
      ? `أُضيف ${result.created} طالب جديد، وتُحدّث ${result.updated}، وسُجّل ${result.enrolled} في المادة${result.alreadyEnrolled > 0 ? ` (بينهم ${result.alreadyEnrolled} مسجلون مسبقاً)` : ""}.`
      : `أُضيف ${result.created} وتُحدّث ${result.updated} طالب، وسُجّل ${result.enrolled} في المادة، مع ${result.errors.length} خطأ تطلّب مراجعة.`;

    return {
      status: ok ? "success" : "partial",
      message,
      created: result.created,
      updated: result.updated,
      enrolled: result.enrolled,
      alreadyEnrolled: result.alreadyEnrolled,
      subjectCode: result.subjectCode,
      errors: result.errors,
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "تعذر استيراد الملف. حاول مرة أخرى لاحقاً.",
      created: 0,
      updated: 0,
      enrolled: 0,
      alreadyEnrolled: 0,
      subjectCode: "",
      errors: [],
    };
  }
}