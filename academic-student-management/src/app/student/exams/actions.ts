"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireAttemptActor } from "@/lib/student-auth";
import {
  saveStudentAnswers,
  startStudentAttempt,
  submitStudentAttempt,
} from "@/lib/student-exams";

export type AttemptActionState = {
  status: "idle" | "success" | "error";
  message?: string;
};

export type SaveAnswersResult = {
  ok: boolean;
  message?: string;
  savedAt?: string;
  answeredCount?: number;
};

const initialState: AttemptActionState = { status: "idle" };

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : "تعذر تنفيذ العملية. حاول مرة أخرى.";
}

export async function startExamAction(
  _prevState: AttemptActionState,
  formData: FormData,
): Promise<AttemptActionState> {
  const actor = await requireAttemptActor();
  const examId = String(formData.get("examId") ?? "");

  if (!examId) return { status: "error", message: "معرف الامتحان مفقود." };

  try {
    await startStudentAttempt(actor.studentId, actor.userId, examId);
  } catch (error) {
    return { status: "error", message: messageOf(error) };
  }

  revalidatePath("/student/exams");
  redirect(`/student/exams/${examId}/attempt`);
}

export async function saveAnswersAction(formData: FormData): Promise<SaveAnswersResult> {
  const actor = await requireAttemptActor();
  const attemptId = String(formData.get("attemptId") ?? "");

  if (!attemptId) return { ok: false, message: "معرف المحاولة مفقود." };

  try {
    const result = await saveStudentAnswers(actor.studentId, attemptId, formData);
    return {
      ok: true,
      savedAt: result.savedAt.toISOString(),
      answeredCount: result.answeredCount,
    };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

export async function submitExamAction(
  _prevState: AttemptActionState,
  formData: FormData,
): Promise<AttemptActionState> {
  const actor = await requireAttemptActor();
  const examId = String(formData.get("examId") ?? "");
  const attemptId = String(formData.get("attemptId") ?? "");

  if (!examId || !attemptId) return { status: "error", message: "بيانات الامتحان غير مكتملة." };

  try {
    await submitStudentAttempt(actor.studentId, actor.userId, attemptId, formData);
  } catch (error) {
    return { status: "error", message: messageOf(error) };
  }

  revalidatePath("/student/exams");
  revalidatePath(`/student/exams/${examId}`);

  redirect(`/student/exams/${examId}/result`);
}
