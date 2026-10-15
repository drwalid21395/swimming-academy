"use server";

import { revalidatePath } from "next/cache";

import { assertProfessorGrant, assertProfessorSubject } from "@/lib/professor-auth";
import { requirePermission } from "@/lib/permissions";
import { importQuestionsForSubjectFromExcel, type QuestionImportFeedback } from "@/lib/question-import";

/** Professors need the granted capability and may only touch their assigned subjects. */
async function assertQuestionImportScope(
  actor: { id: string; role: string },
  subjectId: string,
): Promise<void> {
  if (actor.role !== "PROFESSOR") return;

  await assertProfessorGrant(actor.id, "QUESTIONS_MANAGE");

  await assertProfessorSubject(actor.id, subjectId, "لا تملك صلاحية إدارة أسئلة هذه المادة.");
}

function feedback(
  message: string,
  overrides: Partial<QuestionImportFeedback> = {},
): QuestionImportFeedback {
  return {
    status: "error",
    message,
    created: 0,
    subjectCode: "",
    byType: {},
    errors: [],
    ...overrides,
  };
}

export async function importQuestionsForSubjectExcelAction(
  formData: FormData,
): Promise<QuestionImportFeedback> {
  const actor = await requirePermission("questions.manage");
  const subjectId = String(formData.get("subjectId") ?? "");
  const file = formData.get("file");

  if (!subjectId) return feedback("معرف المادة مفقود.");
  if (!(file instanceof File) || file.size === 0) return feedback("اختر ملف إكسل أولاً.");
  if (!/\.(xlsx|xls)$/i.test(file.name)) {
    return feedback("الملف يجب أن يكون بصيغة إكسل (xlsx أو xls).");
  }

  try {
    await assertQuestionImportScope(actor, subjectId);

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await importQuestionsForSubjectFromExcel(buffer, subjectId, actor.id);

    revalidatePath("/admin/questions");
    revalidatePath("/admin/exams");
    revalidatePath("/professor/questions");
    revalidatePath("/professor/exams");
    revalidatePath(`/admin/subjects/${subjectId}`);

    const byType = result.byType;
    const details = [
      `اختيار من متعدد ${byType.MULTIPLE_CHOICE ?? 0}`,
      `صح وخطأ ${byType.TRUE_FALSE ?? 0}`,
      `إجابة قصيرة ${byType.SHORT_ANSWER ?? 0}`,
      `مقالي ${byType.ESSAY ?? 0}`,
    ].join("، ");

    const ok = result.errors.length === 0;
    const message = ok
      ? `أُضيف ${result.created} سؤالاً إلى بنك أسئلة المادة (${details}).`
      : `أُضيف ${result.created} سؤالاً إلى بنك أسئلة المادة (${details})، مع ${result.errors.length} خطأ تطلّب مراجعة.`;

    return {
      status: ok ? "success" : "partial",
      message,
      created: result.created,
      subjectCode: result.subjectCode,
      byType: result.byType,
      errors: result.errors,
    };
  } catch (error) {
    return feedback(
      error instanceof Error ? error.message : "تعذر استيراد الملف. حاول مرة أخرى لاحقاً.",
    );
  }
}