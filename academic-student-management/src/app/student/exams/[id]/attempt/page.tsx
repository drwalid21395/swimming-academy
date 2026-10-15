import { redirect } from "next/navigation";

import { ButtonLink } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import { getStudentProfile } from "@/lib/student-auth";
import {
  getStudentAttemptForAnswering,
  getStudentAttemptForExam,
  getStudentExamBriefing,
} from "@/lib/student-exams";

import { StudentShell } from "../../../shell";
import { ExamAttemptForm } from "../../exam-attempt-form";

export default async function StudentExamAttemptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const profile = await getStudentProfile();
  const { id: examId } = await params;

  const [exam, attempt] = await Promise.all([
    getStudentExamBriefing(profile.id, examId),
    getStudentAttemptForExam(profile.id, examId),
  ]);

  if (!exam) redirect("/student/exams");
  if (!attempt || attempt.status !== "IN_PROGRESS") {
    redirect(attempt ? `/student/exams/${examId}/result` : `/student/exams/${examId}`);
  }

  const view = await getStudentAttemptForAnswering(profile.id, attempt.id);

  if (!view) redirect(`/student/exams/${examId}`);

  const initialAnswers = Object.fromEntries(
    view.questions
      .filter((question) => question.answer?.trim())
      .map((question) => [question.questionId, question.answer as string]),
  );

  return (
    <StudentShell
      subtitle={`${view.subjectName} · ${view.subjectCode} · ينتهي في ${formatDateTime(exam.endsAt)}`}
      title="أداء الامتحان"
      userName={profile.fullName}
    >
      {view.isTimeUp && (
        <div className="rounded-2xl bg-rose-500/12 px-4 py-3 text-sm font-semibold text-rose-700 ring-1 ring-inset ring-rose-500/25 dark:text-rose-300">
          انتهى وقت الامتحان. سلّم إجاباتك المحفوظة الآن.
        </div>
      )}

      <ExamAttemptForm
        attemptId={view.attemptId}
        examId={view.examId}
        initialAnswers={initialAnswers}
        initialRemainingSeconds={view.remainingSeconds}
        questions={view.questions}
        title={view.title}
      />

      <div className="flex justify-center pt-2">
        <ButtonLink href="/student/exams" size="sm" variant="ghost">
          العودة لقائمة الامتحانات
        </ButtonLink>
      </div>
    </StudentShell>
  );
}
