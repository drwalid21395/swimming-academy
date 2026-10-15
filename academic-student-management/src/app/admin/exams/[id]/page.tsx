import { ArrowRight, CalendarClock, Library, TrendingUp, Users } from "lucide-react";
import { getServerSession } from "next-auth";
import { notFound, redirect } from "next/navigation";

import { adminNavItems } from "@/components/admin-nav";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/primitives";
import { StatCard } from "@/components/ui/stat-card";
import { QueryErrorState } from "@/components/ui/states";
import { authOptions } from "@/auth";
import { getSessionCreators, getSessionSubjects } from "@/lib/attendance";
import { databaseErrorMessage } from "@/lib/dashboard-data";
import { formatDateTime, formatNumber, formatPercent } from "@/lib/format";
import { getBankQuestions, getExamDetail, getExamForEdit } from "@/lib/exams";
import { examStatusLabels, roleLabels } from "@/lib/labels";
import { hasPermission } from "@/lib/permissions";

import { ExamFormDialog } from "../exam-form-dialog";
import { ExamQuestionsManager } from "../exam-questions-manager";
import { ExamRowActions } from "../exam-row-actions";

const statusTones = {
  DRAFT: "neutral",
  PUBLISHED: "success",
  CLOSED: "warning",
  ARCHIVED: "info",
} as const;

export default async function AdminExamDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/sign-in");

  const canManage = hasPermission(session.user.role, "exams.manage");
  const canPublish = hasPermission(session.user.role, "exams.publish");
  const canDelete = hasPermission(session.user.role, "exams.delete");

  const { id } = await params;

  const exam = await getExamDetail(id).catch((error) => {
    console.error("[exam-detail]", error);
    return undefined;
  });

  if (exam === undefined) {
    return (
      <AppShell
        navItems={adminNavItems}
        roleLabel={roleLabels.ADMIN}
        subtitle="تعذر تحميل بيانات الامتحان"
        title="تفاصيل الامتحان"
        userName={session.user.name ?? "مدير النظام"}
      >
        <QueryErrorState message={databaseErrorMessage} />
      </AppShell>
    );
  }

  if (!exam) notFound();

  const [editData, bank, subjects, creators] = await Promise.all([
    canManage ? getExamForEdit(exam.id).catch(() => null) : Promise.resolve(null),
    getBankQuestions(exam.subjectId).catch(() => []),
    getSessionSubjects().catch(() => []),
    getSessionCreators().catch(() => []),
  ]);

  const subjectOptions = subjects.map((subject) => ({
    id: subject.id,
    name: subject.name,
    code: subject.code,
    primaryProfessorId: subject.primaryProfessorId,
  }));

  const creatorOptions = creators.map((creator) => ({
    id: creator.id,
    fullName: creator.user.fullName,
    employeeCode: creator.employeeCode,
  }));

  return (
    <AppShell
      navItems={adminNavItems}
      roleLabel={roleLabels.ADMIN}
      subtitle={`${exam.subjectName} · ${exam.professorName} · ${formatNumber(exam.totalScore)} درجة`}
      title={exam.title}
      userName={session.user.name ?? "مدير النظام"}
    >
      <div>
        <PageHeader
          actions={
            <>
              <ButtonLink href="/admin/exams" size="sm" variant="secondary">
                <ArrowRight aria-hidden className="size-4" />
                رجوع للقائمة
              </ButtonLink>
              {canManage && editData && (
                <ExamFormDialog
                  creators={creatorOptions}
                  exam={editData}
                  mode="edit"
                  subjects={subjectOptions}
                />
              )}
              <ExamRowActions
                canDelete={canDelete}
                canManage={canManage}
                canPublish={canPublish}
                examId={exam.id}
                examTitle={exam.title}
                questionsCount={exam.questions.length}
                status={exam.status}
              />
            </>
          }
          description={`${exam.subjectCode} · ${formatDateTime(exam.startsAt)} → ${formatDateTime(exam.endsAt)}`}
          title="تفاصيل الامتحان"
        />

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            hint="سؤال مرتبط بالامتحان"
            icon={Library}
            label="عدد الأسئلة"
            tone="blue"
            value={formatNumber(exam.questions.length)}
          />
          <StatCard
            hint="محاولة من طلبة المادة"
            icon={Users}
            label="المحاولات"
            tone="violet"
            value={`${formatNumber(exam.attemptsCount)} / ${formatNumber(exam.studentsCount)}`}
          />
          <StatCard
            hint="متوسط درجات المحاولات المصححة"
            icon={TrendingUp}
            label="متوسط الدرجات"
            tone="amber"
            value={formatPercent(exam.averageScore)}
          />
          <StatCard
            hint="مدة الحل المخصصة"
            icon={CalendarClock}
            label="مدة الامتحان"
            tone="emerald"
            value={`${formatNumber(exam.durationMin)} د`}
          />
        </div>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle>أسئلة الامتحان</CardTitle>
              <div className="flex items-center gap-2">
                <Badge tone={statusTones[exam.status]}>{examStatusLabels[exam.status]}</Badge>
                {exam.status === "PUBLISHED" && (
                  <Badge tone={exam.isOpen ? "success" : "neutral"}>
                    {exam.isOpen ? "مفتوح الآن" : "خارج المدة"}
                  </Badge>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <ExamQuestionsManager
              bank={bank}
              canManage={canManage}
              examId={exam.id}
              isDraft={exam.status === "DRAFT"}
              questions={exam.questions}
              totalScore={exam.totalScore}
            />
          </CardContent>
        </Card>

        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>بيانات الامتحان</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-4 sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-semibold text-muted">المادة</dt>
                  <dd className="mt-1 text-sm font-bold">
                    {exam.subjectName} ({exam.subjectCode})
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-muted">عضو هيئة التدريس</dt>
                  <dd className="mt-1 text-sm font-bold">{exam.professorName}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-muted">يبدأ في</dt>
                  <dd className="mt-1 text-sm font-bold">{formatDateTime(exam.startsAt)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-muted">ينتهي في</dt>
                  <dd className="mt-1 text-sm font-bold">{formatDateTime(exam.endsAt)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-muted">الدرجة الكلية</dt>
                  <dd className="mt-1 text-sm font-bold">{formatNumber(exam.totalScore)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-muted">محاولات مُسلّمة</dt>
                  <dd className="mt-1 text-sm font-bold">
                    {formatNumber(exam.submittedCount)} من {formatNumber(exam.attemptsCount)}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>تعليمات الامتحان</CardTitle>
            </CardHeader>
            <CardContent>
              {exam.description ? (
                <p className="text-sm leading-7 text-muted">{exam.description}</p>
              ) : (
                <p className="text-sm text-muted">لا توجد تعليمات مضافة لهذا الامتحان.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
