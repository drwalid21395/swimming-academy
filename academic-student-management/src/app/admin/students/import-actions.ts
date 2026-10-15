"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/permissions";
import {
  importStudentsFromExcel,
  type StudentImportFeedback,
} from "@/lib/student-import";

export async function importStudentsExcelAction(
  formData: FormData,
): Promise<StudentImportFeedback> {
  const actor = await requirePermission("students.manage");
  const file = formData.get("file");

  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", message: "اختر ملف إكسل أولاً.", created: 0, updated: 0, errors: [] };
  }
  if (!/\.(xlsx|xls)$/i.test(file.name)) {
    return {
      status: "error",
      message: "الملف يجب أن يكون بصيغة إكسل (xlsx أو xls).",
      created: 0,
      updated: 0,
      errors: [],
    };
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await importStudentsFromExcel(buffer, actor.id);

    revalidatePath("/admin/students");

    const ok = result.errors.length === 0;
    const message = ok
      ? `تمت إضافة ${result.created} طالب جديد وتحديث بيانات ${result.updated} طالب.`
      : `أُضيف ${result.created} وتُحدّث ${result.updated} طالب، مع ${result.errors.length} خطأ تطلّب مراجعة.`;

    return {
      status: ok ? "success" : "partial",
      message,
      created: result.created,
      updated: result.updated,
      errors: result.errors,
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "تعذر استيراد الملف. حاول مرة أخرى لاحقاً.",
      created: 0,
      updated: 0,
      errors: [],
    };
  }
}