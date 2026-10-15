"use server";

import { revalidatePath } from "next/cache";

import {
  createExam,
  createExamWithQuestions,
  deleteExam,
  examFormSchema,
  setExamStatus,
  updateExam,
  type ExamFormValues,
} from "@/lib/exams";
import { requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { assertProfessorGrant, assertProfessorSubject, loadProfessorScope } from "@/lib/professor-auth";
import { getExamForNotification, notifyEnrolledStudents } from "@/lib/notifications";
import { formatDateTime } from "@/lib/format";

export type ExamActionState = {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Partial<Record<keyof ExamFormValues, string>>;
  values?: Record<string, string>;
  /** Set on success so the UI can deep-link to the created exam. */
  examId?: string;
};

function failure(error: unknown, values?: Record<string, string>): ExamActionState {
  return {
    status: "error",
    message: error instanceof Error ? error.message : "تعذر تنفيذ العملية. حاول مرة أخرى لاحقاً.",
    values,
  };
}

function readExamValues(formData: FormData) {
  const value = (key: string) => String(formData.get(key) ?? "").trim();

  return {
    subjectId: value("subjectId"),
    createdById: value("createdById"),
    title: value("title"),
    description: value("description"),
    startsAt: value("startsAt"),
    endsAt: value("endsAt"),
    durationMin: value("durationMin"),
    totalScore: value("totalScore"),
  };
}

function revalidateExamPaths(examId?: string) {
  revalidatePath("/admin/exams");
  revalidatePath("/professor/exams");
  revalidatePath("/admin/questions");
  revalidatePath("/professor/questions");
  if (examId) {
    revalidatePath(`/admin/exams/${examId}`);
    revalidatePath(`/professor/exams/${examId}`);
  }
}

/**
 * Professors may only create/publish exams for their own subjects, and only when the
 * administrator granted the capability. Admins are unrestricted.
 */
async function assertExamWriteAccess(
  actor: { id: string; role: string },
  subjectId: string,
  permission: "EXAMS_MANAGE",
): Promise<void> {
  if (actor.role !== "PROFESSOR") return;

  await assertProfessorGrant(actor.id, permission);
  await assertProfessorSubject(actor.id, subjectId, "لا تملك صلاحية إنشاء امتحانات في هذه المادة.");
}

/** Professors always author exams as themselves and stay inside their assigned subjects. */
async function pinProfessorAsCreator(actor: { id: string; role: string }): Promise<string | null> {
  if (actor.role !== "PROFESSOR") return null;
  const scope = await loadProfessorScope(actor.id);
  if (!scope) throw new Error("ملف عضو هيئة التدريس غير موجود.");
  return scope.professorId;
}

export async function createExamAction(
  _prevState: ExamActionState,
  formData: FormData,
): Promise<ExamActionState> {
  const actor = await requirePermission("exams.manage");
  const values = readExamValues(formData);
  const parsed = examFormSchema.safeParse(values);

  if (!parsed.success) {
    const flattened = parsed.error.flatten().fieldErrors;
    const fieldErrors: ExamActionState["fieldErrors"] = {};

    for (const [key, messages] of Object.entries(flattened)) {
      if (messages?.[0]) fieldErrors[key as keyof ExamFormValues] = messages[0];
    }

    return {
      status: "error",
      message: "راجع الحقول المطلوبة قبل الحفظ.",
      fieldErrors,
      values,
    };
  }

  try {
    const creatorId = await pinProfessorAsCreator(actor);
    await assertExamWriteAccess(actor, parsed.data.subjectId, "EXAMS_MANAGE");
    if (creatorId) parsed.data.createdById = creatorId;

    const exam = await createExam(parsed.data, actor.id);
    revalidateExamPaths(exam.id);
    return {
      status: "success",
      message: `تم إنشاء الامتحان «${exam.title}». أضف الأسئلة ثم انشره.`,
    };
  } catch (error) {
    return failure(error, values);
  }
}

export async function createExamWithQuestionsAction(
  _prevState: ExamActionState,
  formData: FormData,
): Promise<ExamActionState> {
  const actor = await requirePermission("exams.manage");
  const values = readExamValues(formData);
  const questionIds = formData.getAll("questionIds").map((value) => String(value).trim());
  const parsed = examFormSchema.safeParse(values);

  if (!parsed.success) {
    const flattened = parsed.error.flatten().fieldErrors;
    const fieldErrors: ExamActionState["fieldErrors"] = {};

    for (const [key, messages] of Object.entries(flattened)) {
      if (messages?.[0]) fieldErrors[key as keyof ExamFormValues] = messages[0];
    }

    return {
      status: "error",
      message: "راجع الحقول المطلوبة قبل الحفظ.",
      fieldErrors,
      values,
    };
  }

  if (questionIds.length === 0) {
    return { status: "error", message: "اختر سؤالاً واحداً على الأقل من بنك الأسئلة.", values };
  }

  try {
    const creatorId = await pinProfessorAsCreator(actor);
    await assertExamWriteAccess(actor, parsed.data.subjectId, "EXAMS_MANAGE");
    if (creatorId) parsed.data.createdById = creatorId;

    const exam = await createExamWithQuestions(parsed.data, questionIds, actor.id);
    revalidateExamPaths(exam.id);
    return {
      status: "success",
      examId: exam.id,
      message: `تم إنشاء الامتحان «${exam.title}» وإضافة ${exam.questions} سؤال. راجع الأوزان ثم انشره.`,
    };
  } catch (error) {
    return failure(error, values);
  }
}

export async function updateExamAction(
  _prevState: ExamActionState,
  formData: FormData,
): Promise<ExamActionState> {
  const actor = await requirePermission("exams.manage");
  const examId = String(formData.get("examId") ?? "");
  const values = readExamValues(formData);
  const parsed = examFormSchema.safeParse(values);

  if (!examId) return { status: "error", message: "معرف الامتحان مفقود.", values };

  if (!parsed.success) {
    const flattened = parsed.error.flatten().fieldErrors;
    const fieldErrors: ExamActionState["fieldErrors"] = {};

    for (const [key, messages] of Object.entries(flattened)) {
      if (messages?.[0]) fieldErrors[key as keyof ExamFormValues] = messages[0];
    }

    return {
      status: "error",
      message: "راجع الحقول المطلوبة قبل الحفظ.",
      fieldErrors,
      values,
    };
  }

  try {
    const creatorId = await pinProfessorAsCreator(actor);
    await assertExamWriteAccess(actor, parsed.data.subjectId, "EXAMS_MANAGE");
    if (creatorId) parsed.data.createdById = creatorId;

    const existing = await prisma.exam.findUnique({
      where: { id: examId },
      select: { subjectId: true },
    });
    if (!existing) throw new Error("الامتحان غير موجود.");
    if (actor.role === "PROFESSOR") {
      await assertProfessorSubject(
        actor.id,
        existing.subjectId,
        "لا تملك صلاحية تعديل امتحانات هذه المادة.",
      );
    }

    await updateExam(examId, parsed.data, actor.id);
    revalidateExamPaths(examId);
    return { status: "success", message: "تم تحديث بيانات الامتحان بنجاح." };
  } catch (error) {
    return failure(error, values);
  }
}

export async function setExamStatusAction(
  _prevState: ExamActionState,
  formData: FormData,
): Promise<ExamActionState> {
  const actor = await requirePermission("exams.publish");
  const examId = String(formData.get("examId") ?? "");
  const status = String(formData.get("status") ?? "");
  const target =
    status === "PUBLISHED" || status === "CLOSED" || status === "DRAFT" ? status : null;

  if (!examId || !target) return { status: "error", message: "طلب غير صالح." };

  try {
    if (actor.role === "PROFESSOR") {
      await assertProfessorGrant(actor.id, "EXAMS_MANAGE");

      const existing = await prisma.exam.findUnique({
        where: { id: examId },
        select: { subjectId: true },
      });
      if (!existing) throw new Error("الامتحان غير موجود.");

      await assertProfessorSubject(
        actor.id,
        existing.subjectId,
        "لا تملك صلاحية تغيير حالة امتحانات هذه المادة.",
      );
    }

    await setExamStatus(examId, target, actor.id);
    revalidateExamPaths(examId);

    const messages = {
      PUBLISHED: "تم نشر الامتحان وأصبح متاحاً للطلاب.",
      CLOSED: "تم إغلاق الامتحان ومنع تسليم إجابات جديدة.",
      DRAFT: "تم إرجاع الامتحان إلى حالة المسودة.",
    } as const;

    if (target === "PUBLISHED") {
      const exam = await getExamForNotification(examId);
      if (exam) {
        await notifyEnrolledStudents(exam.subjectId, {
          title: `امتحان جديد: ${exam.title}`,
          content: `تم نشر امتحان "${exam.title}" في مادة ${exam.subject.name}. الموعد: ${formatDateTime(exam.startsAt)}.`,
          link: `/student/exams/${exam.id}`,
        });
      }
    }

    return { status: "success", message: messages[target] };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteExamAction(
  _prevState: ExamActionState,
  formData: FormData,
): Promise<ExamActionState> {
  const actor = await requirePermission("exams.delete");
  const examId = String(formData.get("examId") ?? "");

  if (!examId) return { status: "error", message: "معرف الامتحان مفقود." };

  try {
    await deleteExam(examId, actor.id);
    revalidateExamPaths(examId);
    return { status: "success", message: "تم حذف الامتحان." };
  } catch (error) {
    return failure(error);
  }
}
