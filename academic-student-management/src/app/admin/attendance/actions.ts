"use server";

import { revalidatePath } from "next/cache";

import {
  attendanceStatusEnum,
  createSession,
  deleteSession,
  saveRecordsSchema,
  saveAttendanceRecords,
  sessionFormSchema,
  type SessionFormValues,
} from "@/lib/attendance";
import { prisma } from "@/lib/prisma";
import { loadProfessorScope } from "@/lib/professor-auth";
import { hasProfessorGrant } from "@/lib/professor-permissions";
import { requirePermission } from "@/lib/permissions";

export type AttendanceActionState = {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Partial<Record<keyof SessionFormValues, string>>;
  values?: Record<string, string>;
};

function failure(error: unknown, values?: Record<string, string>): AttendanceActionState {
  return {
    status: "error",
    message:
      error instanceof Error ? error.message : "تعذر تنفيذ العملية. حاول مرة أخرى لاحقاً.",
    values,
  };
}

function readSessionValues(formData: FormData) {
  const value = (key: string) => String(formData.get(key) ?? "").trim();

  return {
    subjectId: value("subjectId"),
    createdById: value("createdById"),
    date: value("date"),
    title: value("title"),
    notes: value("notes"),
  };
}

function revalidateAttendancePaths(sessionId?: string) {
  revalidatePath("/admin/attendance");
  revalidatePath("/professor/attendance");
  revalidatePath("/admin");
  revalidatePath("/professor");
  if (sessionId) {
    revalidatePath(`/admin/attendance/${sessionId}`);
    revalidatePath(`/professor/attendance/${sessionId}`);
  }
}

export async function createSessionAction(
  _prevState: AttendanceActionState,
  formData: FormData,
): Promise<AttendanceActionState> {
  const actor = await requirePermission("attendance.record");
  const values = readSessionValues(formData);
  const parsed = sessionFormSchema.safeParse(values);

  if (!parsed.success) {
    const flattened = parsed.error.flatten().fieldErrors;
    const fieldErrors: AttendanceActionState["fieldErrors"] = {};

    for (const [key, messages] of Object.entries(flattened)) {
      if (messages?.[0]) fieldErrors[key as keyof SessionFormValues] = messages[0];
    }

    return {
      status: "error",
      message: "راجع الحقول المطلوبة قبل الحفظ.",
      fieldErrors,
      values,
    };
  }

  try {
    // Professors and assistants may only create sessions for their own subjects and always as themselves.
    if (actor.role === "PROFESSOR") {
      if (!(await hasProfessorGrant(actor.id, "ATTENDANCE_RECORD"))) {
        throw new Error("لا تملك صلاحية تسجيل الحضور. راجع مسؤول النظام.");
      }
      const scope = await loadProfessorScope(actor.id);
      if (!scope) throw new Error("ملف عضو هيئة التدريس غير موجود.");
      if (!scope.subjectIds.includes(parsed.data.subjectId)) {
        throw new Error("لا تملك صلاحية إنشاء محاضرات في هذه المادة.");
      }
      parsed.data.createdById = scope.professorId;
    }

    const session = await createSession(parsed.data, actor.id);
    revalidateAttendancePaths(session.id);
    return { status: "success", message: "تم إنشاء المحاضرة. يمكنك الآن تسجيل الحضور." };
  } catch (error) {
    return failure(error, values);
  }
}

export async function saveAttendanceAction(
  _prevState: AttendanceActionState,
  formData: FormData,
): Promise<AttendanceActionState> {
  const actor = await requirePermission("attendance.record");

  const sessionId = String(formData.get("sessionId") ?? "");
  const statuses = formData.getAll("status");
  const reasons = formData.getAll("reason");
  const students = formData.getAll("studentId");

  const entries = students
    .map((studentId, index) => {
      const parsedStatus = attendanceStatusEnum.safeParse(String(statuses[index] ?? ""));
      if (!parsedStatus.success) return null;

      return {
        studentId: String(studentId),
        status: parsedStatus.data,
        reason: String(reasons[index] ?? ""),
      };
    })
    .filter((entry): entry is { studentId: string; status: "PRESENT" | "ABSENT" | "EXCUSED"; reason: string } =>
      entry !== null,
    );

  const parsed = saveRecordsSchema.safeParse({ sessionId, entries });

  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "تعذر حفظ سجلات الحضور.",
    };
  }

  try {
    // Professors and assistants may only record attendance for sessions in their own subjects.
    if (actor.role === "PROFESSOR") {
      if (!(await hasProfessorGrant(actor.id, "ATTENDANCE_RECORD"))) {
        throw new Error("لا تملك صلاحية تعديل الحضور. راجع مسؤول النظام.");
      }
      const scope = await loadProfessorScope(actor.id);
      const target = await prisma.attendanceSession.findUnique({
        where: { id: sessionId },
        select: { subjectId: true },
      });
      if (!scope || !target || !scope.subjectIds.includes(target.subjectId)) {
        throw new Error("لا تملك صلاحية تعديل حضور هذه المحاضرة.");
      }
    }

    const result = await saveAttendanceRecords(parsed.data, actor.id);
    revalidateAttendancePaths(parsed.data.sessionId);
    return {
      status: "success",
      message: `تم حفظ ${result.saved} سجل حضور من أصل ${result.total} طالب.`,
    };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteSessionAction(
  _prevState: AttendanceActionState,
  formData: FormData,
): Promise<AttendanceActionState> {
  const actor = await requirePermission("attendance.delete");
  const sessionId = String(formData.get("sessionId") ?? "");

  if (!sessionId) return { status: "error", message: "معرف المحاضرة مفقود." };

  try {
    await deleteSession(sessionId, actor.id);
    revalidateAttendancePaths(sessionId);
    return { status: "success", message: "تم حذف المحاضرة وسجلات حضورها." };
  } catch (error) {
    return failure(error);
  }
}
