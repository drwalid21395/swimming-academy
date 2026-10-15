import { CalendarClock, ClipboardList, Library, Send, TrendingUp } from "lucide-react";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { adminNavItems } from "@/components/admin-nav";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/primitives";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState, QueryErrorState } from "@/components/ui/states";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { authOptions } from "@/auth";
import { databaseErrorMessage } from "@/lib/dashboard-data";
import { getSessionCreators, getSessionSubjects } from "@/lib/attendance";
import { formatDateTime, formatNumber, formatPercent } from "@/lib/format";
import { listExams, parseExamFilters, type ExamFilters, type SearchParams } from "@/lib/exams";
import { examStatusLabels, roleLabels } from "@/lib/labels";
import { hasPermission } from "@/lib/permissions";

import { ExamFilters as Filters } from "./exam-filters";
import { ExamFormDialog } from "./exam-form-dialog";
import { ExamRowActions } from "./exam-row-actions";

const statusTones = {
  DRAFT: "neutral",
  PUBLISHED: "success",
  CLOSED: "warning",
  ARCHIVED: "info",
} as const;

function pageHref(filters: ExamFilters, page: number) {
  const params = new URLSearchParams();

  if (filters.query) params.set("query", filters.query);
  if (filters.subjectId) params.set("subjectId", filters.subjectId);
  if (filters.status) params.set("status", filters.status);
  if (page > 1) params.set("page", String(page));

  const search = params.toString();
  return search ? `/admin/exams?${search}` : "/admin/exams";
}

export default async function AdminExamsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/sign-in");

  const canManage = hasPermission(session.user.role, "exams.manage");
  const canPublish = hasPermission(session.user.role, "exams.publish");
  const canDelete = hasPermission(session.user.role, "exams.delete");

  const query = await searchParams;
  const filters = parseExamFilters(query);

  const [result, subjects, creators] = await Promise.all([
    listExams(filters).catch((error) => {
      console.error("[exams]", error);
      return null;
    }),
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
      subtitle="إنشاء الامتحانات وبنوك الأسئلة ومتابعة المحاولات"
      title="الامتحانات"
      userName={session.user.name ?? "مدير النظام"}
    >
      {!result ? (
        <QueryErrorState message={databaseErrorMessage} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              hint="امتحان في النظام"
              icon={ClipboardList}
              label="عدد الامتحانات"
              tone="blue"
              value={formatNumber(result.totalExams)}
            />
            <StatCard
              hint="متاح للطلاب الآن"
              icon={Send}
              label="امتحانات منشورة"
              tone="emerald"
              value={formatNumber(result.publishedExams)}
            />
            <StatCard
              hint="سؤال في بنك الأسئلة"
              icon={Library}
              label="حجم بنك الأسئلة"
              tone="violet"
              value={formatNumber(result.questionsCount)}
            />
            <StatCard
              hint="متوسط درجات المحاولات المصححة"
              icon={TrendingUp}
              label="متوسط الدرجات"
              tone="amber"
              value={formatPercent(result.averageScore)}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>تصفية وبحث</CardTitle>
            </CardHeader>
            <CardContent>
              <Filters
                initial={{
                  query: filters.query ?? "",
                  subjectId: filters.subjectId ?? "",
                  status: filters.status ?? "",
                }}
                subjects={subjectOptions}
              />
            </CardContent>
          </Card>

          <div>
            <PageHeader
              actions={
                <>
                  <ButtonLink href="/admin/questions" size="sm" variant="secondary">
                    <Library aria-hidden className="size-4" />
                    بنك الأسئلة
                  </ButtonLink>
                  <ButtonLink href="/admin/questions?new=1" size="sm" variant="secondary">
                    <Library aria-hidden className="size-4" />
                    إضافة سؤال
                  </ButtonLink>
                  {canManage && (
                    <ExamFormDialog
                      creators={creatorOptions}
                      initiallyOpen={query.new === "1"}
                      mode="create"
                      subjects={subjectOptions}
                    />
                  )}
                </>
              }
              description={`${formatNumber(result.total)} امتحان مطابق للفلاتر الحالية`}
              title="قائمة الامتحانات"
            />

            <Card className="overflow-hidden">
              {result.rows.length === 0 ? (
                <CardContent>
                  <EmptyState
                    description="أنشئ امتحاناً كمسودة ثم أضف الأسئلة وانشره."
                    title="لا توجد امتحانات مطابقة"
                  />
                </CardContent>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>الامتحان</TH>
                      <TH>المادة</TH>
                      <TH>الموعد</TH>
                      <TH>المدة</TH>
                      <TH>الأسئلة</TH>
                      <TH>المحاولات</TH>
                      <TH>الحالة</TH>
                      <TH>إجراءات</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {result.rows.map((exam) => (
                      <TR key={exam.id}>
                        <TD>
                          <Link
                            className="font-semibold text-slate-800 hover:text-brand-700 dark:text-slate-100"
                            href={`/admin/exams/${exam.id}`}
                          >
                            {exam.title}
                          </Link>
                          <p className="flex items-center gap-1 text-xs text-slate-500">
                            <CalendarClock aria-hidden className="size-3" />
                            {formatNumber(exam.totalScore)} درجة · {exam.professorName}
                          </p>
                        </TD>
                        <TD>{exam.subjectName}</TD>
                        <TD>
                          <span className="text-xs">{formatDateTime(exam.startsAt)}</span>
                        </TD>
                        <TD>{formatNumber(exam.durationMin)} دقيقة</TD>
                        <TD>
                          {formatNumber(exam.questionsCount)}
                          <p className="text-xs text-slate-500">
                            {formatNumber(exam.questionsScore)} / {formatNumber(exam.totalScore)}
                          </p>
                        </TD>
                        <TD>
                          {formatNumber(exam.attemptsCount)} / {formatNumber(exam.studentsCount)}
                          <p className="text-xs text-slate-500">
                            مصحح: {formatNumber(exam.gradedCount)}
                          </p>
                        </TD>
                        <TD>
                          <Badge tone={statusTones[exam.status]}>
                            {examStatusLabels[exam.status]}
                          </Badge>
                        </TD>
                        <TD>
                          <div className="flex items-center justify-end gap-2">
                            <ButtonLink href={`/admin/exams/${exam.id}`} size="sm" variant="ghost">
                              عرض
                            </ButtonLink>
                            <ExamRowActions
                              canDelete={canDelete}
                              canManage={canManage}
                              canPublish={canPublish}
                              examId={exam.id}
                              examTitle={exam.title}
                              questionsCount={exam.questionsCount}
                              status={exam.status}
                            />
                          </div>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </Card>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-500">
              <p>
                صفحة {formatNumber(result.page)} من {formatNumber(result.pageCount)} ·{" "}
                {formatNumber(result.total)} نتيجة
              </p>
              <div className="flex items-center gap-2">
                <ButtonLink
                  aria-disabled={result.page <= 1}
                  className={result.page <= 1 ? "pointer-events-none opacity-50" : undefined}
                  href={pageHref(filters, Math.max(1, result.page - 1))}
                  size="sm"
                  variant="secondary"
                >
                  السابق
                </ButtonLink>
                <ButtonLink
                  aria-disabled={result.page >= result.pageCount}
                  className={result.page >= result.pageCount ? "pointer-events-none opacity-50" : undefined}
                  href={pageHref(filters, Math.min(result.pageCount, result.page + 1))}
                  size="sm"
                  variant="secondary"
                >
                  التالي
                </ButtonLink>
              </div>
            </div>
          </div>
        </>
      )}
    </AppShell>
  );
}
