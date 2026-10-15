import { CalendarClock, CheckCircle2, FileQuestion, Hourglass, Trophy } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState, QueryErrorState } from "@/components/ui/states";
import { databaseErrorMessage } from "@/lib/dashboard-data";
import { formatDateTime, formatNumber, formatPercent, formatScore } from "@/lib/format";
import { getStudentProfile } from "@/lib/student-auth";
import {
  listStudentExams,
  studentExamStateLabels,
  studentExamStateTones,
  type StudentExamRow,
} from "@/lib/student-exams";

import { StudentShell } from "../shell";

function ExamCard({ exam }: { exam: StudentExamRow }) {
  const tone = studentExamStateTones[exam.state];
  const label = studentExamStateLabels[exam.state];
  const canEnter = exam.state === "OPEN" || exam.state === "IN_PROGRESS" || exam.state === "EXPIRED";
  const hasResult = exam.state === "GRADED" || exam.state === "SUBMITTED";

  return (
    <Card className="flex h-full flex-col">
      <CardContent className="flex h-full flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-muted">
              {exam.subjectName} · {exam.subjectCode}
            </p>
            <h3 className="mt-1 font-bold leading-7 text-[var(--app-text)]">
              <Link className="hover:text-brand-600" href={`/student/exams/${exam.id}`}>
                {exam.title}
              </Link>
            </h3>
          </div>
          <Badge tone={tone}>{label}</Badge>
        </div>

        {exam.description && (
          <p className="line-clamp-2 text-sm leading-6 text-muted">{exam.description}</p>
        )}

        <dl className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <dt className="text-muted">يبدأ</dt>
            <dd className="mt-0.5 font-semibold text-[var(--app-text)]">
              {formatDateTime(exam.startsAt)}
            </dd>
          </div>
          <div>
            <dt className="text-muted">ينتهي</dt>
            <dd className="mt-0.5 font-semibold text-[var(--app-text)]">
              {formatDateTime(exam.endsAt)}
            </dd>
          </div>
          <div>
            <dt className="text-muted">المدة</dt>
            <dd className="mt-0.5 font-semibold text-[var(--app-text)]">
              {formatNumber(exam.durationMin)} دقيقة
            </dd>
          </div>
          <div>
            <dt className="text-muted">الدرجة الكلية</dt>
            <dd className="mt-0.5 font-semibold text-[var(--app-text)]">
              {formatScore(exam.totalScore, 0)}
            </dd>
          </div>
        </dl>

        {hasResult && (
          <div className="rounded-2xl bg-[var(--glass-bg)] p-3 ring-1 ring-inset ring-[var(--glass-border)]">
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="text-muted">درجتك</span>
              <span className="font-bold text-[var(--app-text)]">
                {formatScore(exam.attemptScore)} / {formatScore(exam.totalScore, 0)} ·{" "}
                {formatPercent(exam.percentage)}
              </span>
            </div>
            <Progress
              tone={exam.state === "GRADED" ? "emerald" : "amber"}
              value={exam.percentage ?? 0}
            />
          </div>
        )}

        <div className="mt-auto flex items-center gap-2 pt-1">
          {canEnter ? (
            <ButtonLink href={`/student/exams/${exam.id}/attempt`} size="sm">
              {exam.state === "IN_PROGRESS"
                ? "متابعة الإجابة"
                : exam.state === "EXPIRED"
                  ? "تسليم الإجابات المحفوظة"
                  : "ابدأ الامتحان"}
            </ButtonLink>
          ) : hasResult ? (
            <ButtonLink href={`/student/exams/${exam.id}/result`} size="sm" variant="secondary">
              عرض النتيجة
            </ButtonLink>
          ) : (
            <ButtonLink href={`/student/exams/${exam.id}`} size="sm" variant="secondary">
              تفاصيل الامتحان
            </ButtonLink>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ExamSection({
  title,
  description,
  icon: Icon,
  exams,
  emptyTitle,
  emptyDescription,
}: {
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  exams: StudentExamRow[];
  emptyTitle: string;
  emptyDescription: string;
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <Icon className="size-5 text-brand-600 dark:text-brand-300" />
        <div>
          <h2 className="font-bold text-[var(--app-text)]">{title}</h2>
          <p className="text-xs text-muted">{description}</p>
        </div>
      </div>

      {exams.length === 0 ? (
        <EmptyState description={emptyDescription} title={emptyTitle} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {exams.map((exam) => (
            <ExamCard exam={exam} key={exam.id} />
          ))}
        </div>
      )}
    </section>
  );
}

export default async function StudentExamsPage() {
  const profile = await getStudentProfile();

  const result = await listStudentExams(profile.id).catch((error) => {
    console.error("[student-exams]", error);
    return null;
  });

  return (
    <StudentShell
      subtitle={`${formatNumber(result?.total ?? 0)} امتحان في موادك المسجلة · ${profile.fullName}`}
      title="امتحاناتي"
      userName={profile.fullName}
    >
      {!result ? (
        <QueryErrorState message={databaseErrorMessage} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              hint="امتحانات مفتوحة الآن"
              icon={FileQuestion}
              label="متاح الآن"
              tone="emerald"
              value={formatNumber(result.openCount)}
            />
            <StatCard
              hint="بانتظار إتمام الإجابة"
              icon={Hourglass}
              label="قيد الإجابة"
              tone="amber"
              value={formatNumber(result.inProgressCount)}
            />
            <StatCard
              hint="في انتظار تصحيح الأستاذ"
              icon={CheckCircle2}
              label="بانتظار التصحيح"
              tone="violet"
              value={formatNumber(result.awaitingCount)}
            />
            <StatCard
              hint="متوسط درجاتك في الامتحانات المصححة"
              icon={Trophy}
              label="متوسط الدرجات"
              tone="blue"
              value={formatPercent(result.averagePercentage)}
            />
          </div>

          <ExamSection
            description="امتحانات يمكنك الإجابة عنها الآن"
            emptyDescription="ستظهر هنا الامتحانات المتاحة عند نشرها من قِبل أعضاء هيئة التدريس."
            emptyTitle="لا توجد امتحانات متاحة"
            exams={result.available}
            icon={CalendarClock}
            title="متاح الآن"
          />

          <ExamSection
            description="امتحانات لم يبدأ وقتها بعد"
            emptyDescription="لا توجد امتبارات قادمة."
            emptyTitle="لا توجد امتحانات قادمة"
            exams={result.upcoming}
            icon={CalendarClock}
            title="قريباً"
          />

          <ExamSection
            description="امتحانات سلّمتها أو تم تصحيحها"
            emptyDescription="ستظهر نتائجك هنا بعد التسليم."
            emptyTitle="لا توجد نتائج"
            exams={result.history}
            icon={Trophy}
            title="السجل والنتائج"
          />
        </>
      )}
    </StudentShell>
  );
}
