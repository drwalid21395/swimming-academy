import { BookMarked, ClipboardList, HelpCircle, Layers, Sparkles } from "lucide-react";
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
import { getSessionCreators, getSessionSubjects } from "@/lib/attendance";
import { databaseErrorMessage } from "@/lib/dashboard-data";
import {
  getQuestionCategories,
  getQuestionForEdit,
  listQuestions,
  parseQuestionFilters,
  type QuestionFilters,
  type SearchParams,
} from "@/lib/exams";
import { formatDate, formatNumber } from "@/lib/format";
import { difficultyLabels, questionTypeLabels, roleLabels } from "@/lib/labels";
import { hasPermission } from "@/lib/permissions";

import { ExamFormDialog } from "../exams/exam-form-dialog";
import { ExamPreviewButton } from "./exam-preview-dialog";
import { QuestionFilters as Filters } from "./question-filters";
import { QuestionFormDialog } from "./question-form-dialog";
import { QuestionPreviewDialog } from "./question-preview-dialog";
import { QuestionRowActions } from "./question-row-actions";
import {
  QuestionSelectCheckbox,
  QuestionSelectionProvider,
  SelectAllQuestionsCheckbox,
} from "./question-selection";

const difficultyTones = {
  EASY: "success",
  MEDIUM: "warning",
  HARD: "danger",
} as const;

function pageHref(filters: QuestionFilters, page: number) {
  const params = new URLSearchParams();

  if (filters.query) params.set("query", filters.query);
  if (filters.subjectId) params.set("subjectId", filters.subjectId);
  if (filters.type) params.set("type", filters.type);
  if (filters.difficulty) params.set("difficulty", filters.difficulty);
  if (page > 1) params.set("page", String(page));

  const search = params.toString();
  return search ? `/admin/questions?${search}` : "/admin/questions";
}

export default async function AdminQuestionsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/sign-in");

  const canManage = hasPermission(session.user.role, "questions.manage");
  const canDelete = hasPermission(session.user.role, "questions.delete");

  const query = await searchParams;
  const filters = parseQuestionFilters(query);

  const [result, subjects, creators, categories] = await Promise.all([
    listQuestions(filters).catch((error) => {
      console.error("[questions]", error);
      return null;
    }),
    getSessionSubjects().catch(() => []),
    getSessionCreators().catch(() => []),
    getQuestionCategories(filters.subjectId).catch(() => []),
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

  const editTargets = canManage
    ? await Promise.all(
        (result?.rows ?? []).map((question) => getQuestionForEdit(question.id).catch(() => null)),
      )
    : [];

  return (
    <AppShell
      navItems={adminNavItems}
      roleLabel={roleLabels.ADMIN}
      subtitle="بناء بنك الأسئلة لكل مادة واستخدامها في الامتحانات"
      title="بنك الأسئلة"
      userName={session.user.name ?? "مدير النظام"}
    >
      {!result ? (
        <QueryErrorState message={databaseErrorMessage} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              hint="سؤال في البنك"
              icon={Layers}
              label="إجمالي الأسئلة"
              tone="blue"
              value={formatNumber(result.totalQuestions)}
            />
            <StatCard
              hint="أسئلة اختيار من متعدد"
              icon={HelpCircle}
              label="اختيار من متعدد"
              tone="violet"
              value={formatNumber(result.byType.MULTIPLE_CHOICE)}
            />
            <StatCard
              hint="صح وخطأ + إجابات كتابية"
              icon={BookMarked}
              label="أسئلة كتابية"
              tone="emerald"
              value={formatNumber(
                result.byType.TRUE_FALSE + result.byType.SHORT_ANSWER + result.byType.ESSAY,
              )}
            />
            <StatCard
              hint="غير مستخدمة في أي امتحان"
              icon={Sparkles}
              label="أسئلة غير مستخدمة"
              tone="amber"
              value={formatNumber(result.unusedQuestions)}
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
                  type: filters.type ?? "",
                  difficulty: filters.difficulty ?? "",
                }}
                subjects={subjectOptions}
              />
            </CardContent>
          </Card>

          <QuestionSelectionProvider
            creators={creatorOptions}
            questions={result.rows}
            subjects={subjectOptions}
          >
            <div>
              <PageHeader
                actions={
                  <>
                    <ButtonLink href="/admin/exams" size="sm" variant="secondary">
                      الامتحانات
                    </ButtonLink>
                    <ButtonLink href="/admin/exams?new=1" size="sm" variant="secondary">
                      <ClipboardList aria-hidden className="size-4" />
                      نموذج امتحان جديد
                    </ButtonLink>
                    <ExamPreviewButton questions={result.rows} />
                    {canManage && (
                      <>
                        <ExamFormDialog
                          creators={creatorOptions}
                          mode="create"
                          subjects={subjectOptions}
                        />
                        <QuestionFormDialog
                          categories={categories}
                          creators={creatorOptions}
                          initiallyOpen={query.new === "1"}
                          mode="create"
                          subjects={subjectOptions}
                        />
                      </>
                    )}
                  </>
                }
                description={`${formatNumber(result.total)} سؤال مطابق للفلاتر الحالية · حدّد الأسئلة لإنشاء امتحان منها أو جرّبها كنموذج تدريب`}
                title="قائمة الأسئلة"
              />

              <Card className="overflow-hidden">
                {result.rows.length === 0 ? (
                  <CardContent>
                    <EmptyState
                      description="أضف سؤالاً إلى بنك الأسئلة ليستخدم في الامتحانات."
                      title="لا توجد أسئلة مطابقة"
                    />
                  </CardContent>
                ) : (
                  <Table>
                    <THead>
                      <TR>
                        <TH className="w-10">
                          <SelectAllQuestionsCheckbox />
                        </TH>
                        <TH>السؤال</TH>
                        <TH>المادة</TH>
                        <TH>النوع</TH>
                        <TH>الصعوبة</TH>
                        <TH>الوحدة</TH>
                        <TH>التصنيف</TH>
                        <TH>مستخدم في</TH>
                        <TH>أضيف في</TH>
                        <TH>إجراءات</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {result.rows.map((question, index) => (
                        <TR key={question.id}>
                          <TD>
                            <QuestionSelectCheckbox questionId={question.id} />
                          </TD>
                          <TD>
                          <p className="max-w-xl font-semibold leading-6 text-slate-800 dark:text-slate-100">
                            {question.text}
                          </p>
                          {question.correctAnswer && (
                            <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">
                              الإجابة: {question.correctAnswer}
                            </p>
                          )}
                        </TD>
                        <TD>{question.subjectName}</TD>
                        <TD>
                          <Badge tone="blue">{questionTypeLabels[question.type]}</Badge>
                          {question.optionsCount > 0 && (
                            <p className="mt-1 text-xs text-muted">
                              {formatNumber(question.optionsCount)} خيارات
                            </p>
                          )}
                        </TD>
                        <TD>
                          <Badge tone={difficultyTones[question.difficulty]}>
                            {difficultyLabels[question.difficulty]}
                          </Badge>
                        </TD>
                        <TD>{question.unit ?? <span className="text-muted">—</span>}</TD>
                        <TD>{question.categoryName ?? <span className="text-muted">—</span>}</TD>
                        <TD>
                          {question.usedInExams > 0 ? (
                            <Badge tone="info">{formatNumber(question.usedInExams)} امتحان</Badge>
                          ) : (
                            <span className="text-xs text-muted">غير مستخدم</span>
                          )}
                        </TD>
                        <TD className="text-xs">{formatDate(question.createdAt)}</TD>
                        <TD>
                          <div className="flex items-center justify-end gap-2">
                            <QuestionPreviewDialog question={question} />
                            {canManage && editTargets[index] && (
                              <QuestionFormDialog
                                categories={categories}
                                creators={creatorOptions}
                                initiallyOpen={query.edit === question.id}
                                mode="edit"
                                question={editTargets[index] ?? undefined}
                                subjects={subjectOptions}
                              />
                            )}
                            <QuestionRowActions
                              canDelete={canDelete}
                              questionId={question.id}
                              snippet={question.text}
                              usedInExams={question.usedInExams}
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
          </QuestionSelectionProvider>
        </>
      )}
    </AppShell>
  );
}
