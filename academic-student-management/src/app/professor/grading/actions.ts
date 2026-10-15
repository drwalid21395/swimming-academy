"use server";

import { revalidatePath } from "next/cache";

import { assertProfessorGrant, requireGradingActor } from "@/lib/professor-auth";
import { saveAttemptGrades, type SaveGradesResult } from "@/lib/professor-exams";

export type GradingActionState = {
  status: "idle" | "success" | "error";
  message?: string;
  score?: number;
  totalScore?: number;
  savedAt?: string;
};

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : "تعذر حفظ الدرجات. حاول مرة أخرى.";
}

export async function saveGradesAction(
  _prevState: GradingActionState,
  formData: FormData,
): Promise<GradingActionState> {
  const actor = await requireGradingActor();
  const attemptId = String(formData.get("attemptId") ?? "");
  const examId = String(formData.get("examId") ?? "");

  if (!attemptId) return { status: "error", message: "معرف المحاولة مفقود." };

  let result: SaveGradesResult;

  try {
    await assertProfessorGrant(actor.userId, "RESULTS_VIEW");
    result = await saveAttemptGrades(actor, attemptId, formData);
  } catch (error) {
    return { status: "error", message: messageOf(error) };
  }

  revalidatePath("/professor/grading");
  revalidatePath(`/professor/grading/${attemptId}`);
  if (examId) {
    revalidatePath(`/professor/exams/${examId}`);
  }
  revalidatePath("/professor/exams");
  revalidatePath("/professor");

  return {
    status: "success",
    message: "تم اعتماد الدرجات بنجاح.",
    score: result.score,
    totalScore: result.totalScore,
    savedAt: result.savedAt.toISOString(),
  };
}
