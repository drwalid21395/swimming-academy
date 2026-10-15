"use server";

import { revalidatePath } from "next/cache";

import {
  attachQuestionsSchema,
  attachQuestionsToExam,
  removeQuestionFromExam,
  updateExamQuestionScore,
} from "@/lib/exams";
import { requirePermission } from "@/lib/permissions";
import { assertProfessorExamAccess } from "@/lib/professor-auth";

export type ExamQuestionActionState = {
  status: "idle" | "success" | "error";
  message?: string;
};

const initialState: ExamQuestionActionState = { status: "idle" };

function failure(error: unknown): ExamQuestionActionState {
  return {
    status: "error",
    message: error instanceof Error ? error.message : "تعذر تنفيذ العملية. حاول مرة أخرى لاحقاً.",
  };
}

function revalidateExamPaths(examId: string) {
  revalidatePath(`/admin/exams/${examId}`);
  revalidatePath("/admin/exams");
}

export async function attachQuestionsAction(
  _prevState: ExamQuestionActionState,
  formData: FormData,
): Promise<ExamQuestionActionState> {
  const actor = await requirePermission("exams.manage");
  const examId = String(formData.get("examId") ?? "");
  const questionIds = formData.getAll("questionId").map(String).filter(Boolean);
  const parsed = attachQuestionsSchema.safeParse({ examId, questionIds });

  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "اختر سؤالاً واحداً على الأقل.",
    };
  }

  try {
    if (actor.role === "PROFESSOR") {
      await assertProfessorExamAccess(actor.id, parsed.data.examId, "EXAMS_MANAGE");
    }

    const result = await attachQuestionsToExam(parsed.data.examId, parsed.data.questionIds, actor.id);
    revalidateExamPaths(parsed.data.examId);

    return {
      status: "success",
      message:
        result.skipped > 0
          ? `تمت إضافة ${result.added} سؤال وتجاهل ${result.skipped} موجود مسبقاً.`
          : `تمت إضافة ${result.added} سؤال إلى الامتحان.`,
    };
  } catch (error) {
    return failure(error);
  }
}

export async function removeExamQuestionAction(
  _prevState: ExamQuestionActionState,
  formData: FormData,
): Promise<ExamQuestionActionState> {
  const actor = await requirePermission("exams.manage");
  const examId = String(formData.get("examId") ?? "");
  const questionId = String(formData.get("questionId") ?? "");

  if (!examId || !questionId) return { status: "error", message: "بيانات غير كاملة." };

  try {
    if (actor.role === "PROFESSOR") {
      await assertProfessorExamAccess(actor.id, examId, "EXAMS_MANAGE");
    }

    await removeQuestionFromExam(examId, questionId, actor.id);
    revalidateExamPaths(examId);
    return { status: "success", message: "تم حذف السؤال من الامتحان." };
  } catch (error) {
    return failure(error);
  }
}

export async function updateQuestionScoreAction(
  _prevState: ExamQuestionActionState,
  formData: FormData,
): Promise<ExamQuestionActionState> {
  const actor = await requirePermission("exams.manage");
  const examId = String(formData.get("examId") ?? "");
  const questionId = String(formData.get("questionId") ?? "");
  const score = Number(String(formData.get("score") ?? ""));

  if (!examId || !questionId || !Number.isFinite(score)) {
    return { status: "error", message: "بيانات غير كاملة." };
  }

  try {
    if (actor.role === "PROFESSOR") {
      await assertProfessorExamAccess(actor.id, examId, "EXAMS_MANAGE");
    }

    await updateExamQuestionScore(examId, questionId, score, actor.id);
    revalidateExamPaths(examId);
    return { status: "success", message: "تم تحديث درجة السؤال." };
  } catch (error) {
    return failure(error);
  }
}
