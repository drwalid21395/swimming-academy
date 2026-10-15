"use server";

import { revalidatePath } from "next/cache";

import {
  createQuestion,
  deleteQuestion,
  questionFormSchema,
  updateQuestion,
  type QuestionFormValues,
} from "@/lib/exams";
import { prisma } from "@/lib/prisma";
import { assertProfessorGrant, assertProfessorSubject } from "@/lib/professor-auth";
import { requirePermission } from "@/lib/permissions";

export type QuestionActionState = {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Partial<Record<keyof QuestionFormValues, string>>;
  values?: Record<string, string>;
};

function failure(error: unknown, values?: Record<string, string>): QuestionActionState {
  return {
    status: "error",
    message: error instanceof Error ? error.message : "تعذر تنفيذ العملية. حاول مرة أخرى لاحقاً.",
    values,
  };
}

function readQuestionValues(formData: FormData) {
  const value = (key: string) => String(formData.get(key) ?? "").trim();

  return {
    subjectId: value("subjectId"),
    createdById: value("createdById"),
    categoryId: value("categoryId"),
    text: value("text"),
    type: value("type") || "MULTIPLE_CHOICE",
    difficulty: value("difficulty") || "MEDIUM",
    unit: value("unit"),
    chapter: value("chapter"),
    correctAnswer: value("correctAnswer"),
    explanation: value("explanation"),
  };
}

function readOptions(formData: FormData) {
  const rawCorrectIndex = formData.get("correctOptionIndex");
  const correctIndex = rawCorrectIndex === null ? -1 : Number(rawCorrectIndex);

  return formData
    .getAll("optionText")
    .map(String)
    .map((text, index) => ({
      text: text.trim(),
      isCorrect: index === correctIndex,
    }))
    .filter((option) => option.text.length > 0);
}

function revalidateQuestionPaths() {
  revalidatePath("/admin/questions");
  revalidatePath("/admin/exams");
  revalidatePath("/professor/questions");
  revalidatePath("/professor/exams");
}

/** Professors need the granted capability and may only touch their assigned subjects. */
async function assertQuestionScope(
  actor: { id: string; role: string },
  subjectId: string,
): Promise<void> {
  if (actor.role !== "PROFESSOR") return;

  await assertProfessorGrant(actor.id, "QUESTIONS_MANAGE");

  // Delegated so an assistant is checked against the inherited supervisor scope.
  await assertProfessorSubject(actor.id, subjectId, "لا تملك صلاحية إدارة أسئلة هذه المادة.");
}

export async function createQuestionAction(
  _prevState: QuestionActionState,
  formData: FormData,
): Promise<QuestionActionState> {
  const actor = await requirePermission("questions.manage");
  const values = readQuestionValues(formData);
  const parsed = questionFormSchema.safeParse(values);

  if (!parsed.success) {
    const flattened = parsed.error.flatten().fieldErrors;
    const fieldErrors: QuestionActionState["fieldErrors"] = {};

    for (const [key, messages] of Object.entries(flattened)) {
      if (messages?.[0]) fieldErrors[key as keyof QuestionFormValues] = messages[0];
    }

    return { status: "error", message: "راجع الحقول المطلوبة قبل الحفظ.", fieldErrors, values };
  }

  try {
    await assertQuestionScope(actor, parsed.data.subjectId);
    await createQuestion(parsed.data, readOptions(formData), actor.id);
    revalidateQuestionPaths();
    return { status: "success", message: "تمت إضافة السؤال إلى البنك بنجاح." };
  } catch (error) {
    return failure(error, values);
  }
}

export async function updateQuestionAction(
  _prevState: QuestionActionState,
  formData: FormData,
): Promise<QuestionActionState> {
  const actor = await requirePermission("questions.manage");
  const questionId = String(formData.get("questionId") ?? "");
  const values = readQuestionValues(formData);
  const parsed = questionFormSchema.safeParse(values);

  if (!questionId) return { status: "error", message: "معرف السؤال مفقود.", values };

  if (!parsed.success) {
    const flattened = parsed.error.flatten().fieldErrors;
    const fieldErrors: QuestionActionState["fieldErrors"] = {};

    for (const [key, messages] of Object.entries(flattened)) {
      if (messages?.[0]) fieldErrors[key as keyof QuestionFormValues] = messages[0];
    }

    return { status: "error", message: "راجع الحقول المطلوبة قبل الحفظ.", fieldErrors, values };
  }

  try {
    const existing = await prisma.question.findUnique({
      where: { id: questionId },
      select: { subjectId: true },
    });
    if (!existing) throw new Error("السؤال غير موجود.");

    await assertQuestionScope(actor, existing.subjectId);
    await assertQuestionScope(actor, parsed.data.subjectId);
    await updateQuestion(questionId, parsed.data, readOptions(formData), actor.id);
    revalidateQuestionPaths();
    return { status: "success", message: "تم تحديث السؤال بنجاح." };
  } catch (error) {
    return failure(error, values);
  }
}

export async function deleteQuestionAction(
  _prevState: QuestionActionState,
  formData: FormData,
): Promise<QuestionActionState> {
  const actor = await requirePermission("questions.delete");
  const questionId = String(formData.get("questionId") ?? "");

  if (!questionId) return { status: "error", message: "معرف السؤال مفقود." };

  try {
    await deleteQuestion(questionId, actor.id);
    revalidateQuestionPaths();
    return { status: "success", message: "تم حذف السؤال من البنك." };
  } catch (error) {
    return failure(error);
  }
}
