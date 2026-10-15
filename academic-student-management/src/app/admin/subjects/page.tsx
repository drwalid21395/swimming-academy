import { BookOpen, Building2, CalendarCheck, GraduationCap, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { adminNavItems } from "@/components/admin-nav";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/primitives";
import { attendanceTone, Progress } from "@/components/ui/progress";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState, QueryErrorState } from "@/components/ui/states";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { authOptions } from "@/auth";
import { databaseErrorMessage } from "@/lib/dashboard-data";
import { listDepartments } from "@/lib/departments";
import { formatNumber, formatPercent } from "@/lib/format";
import { roleLabels } from "@/lib/labels";
import { hasPermission } from "@/lib/permissions";
import {
  getAcademicTerms,
  getDepartments,
  getProfessors,
  listSubjects,
  parseSubjectFilters,
  type SubjectFilters,
  type SubjectSearchParams,
} from "@/lib/subjects";

import { DepartmentFormDialog } from "./department-form-dialog";
import { DepartmentRowActions } from "./department-row-actions";
import { SubjectFilters as Filters } from "./subject-filters";
import { SubjectFormDialog } from "./subject-form-dialog";
import { SubjectRowActions } from "./subject-row-actions";

function pageHref(filters: SubjectFilters, page: number) {
  const params = new URLSearchParams();

  if (filters.query) params.set("query", filters.query);
  if (filters.departmentId) params.set("departmentId", filters.departmentId);
  if (filters.academicTermId) params.set("academicTermId", filters.academicTermId);
  if (page > 1) params.set("page", String(page));

  const search = params.toString();
  return search ? `/admin/subjects?${search}` : "/admin/subjects";
}

export default async function AdminSubjectsPage({
  searchParams,
}: {
  searchParams: Promise<SubjectSearchParams>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/sign-in");

  const canManage = hasPermission(session.user.role, "subjects.manage");
  const canDelete = hasPermission(session.user.role, "subjects.delete");

  const query = await searchParams;
  const filters = parseSubjectFilters(query);

  const [result, departments, terms, professors, departmentRows] = await Promise.all([
    listSubjects(filters).catch((error) => {
      console.error("[subjects]", error);
      return null;
    }),
    getDepartments().catch(() => []),
    getAcademicTerms().catch(() => []),
    getProfessors().catch(() => []),
    listDepartments().catch(() => []),
  ]);

  const professorOptions = professors.map((professor) => ({
    id: professor.id,
    fullName: professor.user.fullName,
    employeeCode: professor.employeeCode,
    departmentId: professor.departmentId,
    isActive: professor.user.isActive,
  }));

  return (
    <AppShell
      navItems={adminNavItems}
      roleLabel={roleLabels.ADMIN}
      subtitle="إدارة المواد الدراسية وتسجيل الطلاب فيها"
      title="المواد الدراسية"
      userName={session.user.name ?? "مدير النظام"}
    >
      {!result ? (
        <QueryErrorState message={databaseErrorMessage} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              hint="إجمالي المواد المسجلة"
              icon={BookOpen}
              label="عدد المواد"
              tone="blue"
              value={formatNumber(result.totalSubjects)}
            />
            <StatCard
              hint="إجمالي الطلاب في النظام"
              icon={GraduationCap}
              label="عدد الطلاب"
              tone="violet"
              value={formatNumber(result.totalStudents)}
            />
            <StatCard
              hint="متوسط حضور المواد المعروضة"
              icon={CalendarCheck}
              label="متوسط الحضور"
              tone={attendanceTone(result.averageAttendance)}
              value={formatPercent(result.averageAttendance)}
            />
            <StatCard
              hint="مواد فيها طلاب دون الحد المسموح"
              icon={TriangleAlert}
              label="مواد بها طلاب دون الحد"
              tone="rose"
              value={formatNumber(
                result.rows.filter((row) => row.lowAttendanceCount > 0).length,
              )}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>تصفية وبحث</CardTitle>
            </CardHeader>
            <CardContent>
              <Filters
                departments={departments}
                initial={{
                  query: filters.query ?? "",
                  departmentId: filters.departmentId ?? "",
                  academicTermId: filters.academicTermId ?? "",
                }}
                terms={terms}
              />
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Building2 aria-hidden className="size-5 text-brand-600" />
                إدارة الأقسام
                <Badge tone="violet">{formatNumber(departmentRows.length)}</Badge>
              </CardTitle>
              {canManage && <DepartmentFormDialog mode="create" professors={professorOptions} />}
            </CardHeader>
            {departmentRows.length === 0 ? (
              <CardContent>
                <EmptyState
                  description="أنشئ قسماً أولاً ثم أضف المواد والدكاترة المرتبطة به."
                  title="لا توجد أقسام بعد"
                />
              </CardContent>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>القسم</TH>
                    <TH>رئيس القسم</TH>
                    <TH>الدكاترة</TH>
                    <TH>المواد</TH>
                    <TH>الطلاب</TH>
                    {canManage && <TH>إجراءات</TH>}
                  </TR>
                </THead>
                <TBody>
                  {departmentRows.map((department) => (
                    <TR key={department.id}>
                      <TD>
                        <span className="font-semibold text-slate-800 dark:text-slate-100">
                          {department.name}
                        </span>
                        <p className="text-xs text-slate-500" dir="ltr">
                          {department.code}
                        </p>
                      </TD>
                      <TD>
                        {department.head ? (
                          <>
                            <span className="font-semibold text-slate-800 dark:text-slate-100">
                              {department.head.fullName}
                            </span>
                            <p className="text-xs text-slate-500" dir="ltr">
                              {department.head.email}
                            </p>
                          </>
                        ) : (
                          <span className="text-sm text-muted">غير محدد</span>
                        )}
                      </TD>
                      <TD>{formatNumber(department.professorsCount)}</TD>
                      <TD>{formatNumber(department.subjectsCount)}</TD>
                      <TD>{formatNumber(department.studentsCount)}</TD>
                      {canManage && (
                        <TD>
                          <div className="flex items-center justify-end gap-2">
                            <DepartmentFormDialog
                              department={department}
                              mode="edit"
                              professors={professorOptions}
                            />
                            <DepartmentRowActions
                              canDelete={canDelete}
                              departmentId={department.id}
                              departmentName={department.name}
                            />
                          </div>
                        </TD>
                      )}
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>

          <div>
            <PageHeader
              actions={
                canManage ? (
                  <SubjectFormDialog
                    departments={departments}
                    initiallyOpen={query.new === "1"}
                    mode="create"
                    professors={professorOptions}
                    terms={terms}
                  />
                ) : undefined
              }
              description={`${formatNumber(result.total)} مادة مطابقة للفلاتر الحالية`}
              title="قائمة المواد"
            />

            <Card className="overflow-hidden">
              {result.rows.length === 0 ? (
                <CardContent>
                  <EmptyState
                    description="جرّب تعديل الفلاتر أو أضف مادة دراسية جديدة للبدء."
                    title="لا توجد مواد مطابقة"
                  />
                </CardContent>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>المادة</TH>
                      <TH>القسم</TH>
                      <TH>الفصل الدراسي</TH>
                      <TH>الأستاذ المسؤول</TH>
                      <TH>الطلاب</TH>
                      <TH className="w-44">نسبة الحضور</TH>
                      <TH>الامتحانات</TH>
                      <TH>إجراءات</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {result.rows.map((subject) => (
                      <TR key={subject.id}>
                        <TD>
                          <Link
                            className="font-semibold text-slate-800 hover:text-brand-700 dark:text-slate-100"
                            href={`/admin/subjects/${subject.id}`}
                          >
                            {subject.name}
                          </Link>
                          <p className="text-xs text-slate-500" dir="ltr">
                            {subject.code} · {formatNumber(subject.creditHours)} ساعات
                          </p>
                        </TD>
                        <TD>{subject.departmentName}</TD>
                        <TD>{subject.academicTermName}</TD>
                        <TD>{subject.professorName ?? <span className="text-muted">غير محدد</span>}</TD>
                        <TD>{formatNumber(subject.studentsCount)}</TD>
                        <TD>
                          <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
                            <span className="text-slate-500">
                              {formatNumber(subject.attendance.present)} /{" "}
                              {formatNumber(subject.attendance.total)}
                            </span>
                            <span className="font-semibold text-slate-700 dark:text-slate-200">
                              {formatPercent(subject.attendance.percentage)}
                            </span>
                          </div>
                          <Progress
                            size="sm"
                            tone={attendanceTone(subject.attendance.percentage)}
                            value={subject.attendance.percentage}
                          />
                          {subject.lowAttendanceCount > 0 && (
                            <Badge className="mt-1.5" tone="danger">
                              {formatNumber(subject.lowAttendanceCount)} دون الحد
                            </Badge>
                          )}
                        </TD>
                        <TD>
                          {formatNumber(subject.examsCount)}
                          <p className="text-xs text-slate-500">
                            {formatNumber(subject.questionsCount)} سؤال
                          </p>
                        </TD>
                        <TD>
                          <div className="flex items-center justify-end gap-2">
                            <ButtonLink
                              href={`/admin/subjects/${subject.id}`}
                              size="sm"
                              variant="ghost"
                            >
                              عرض
                            </ButtonLink>
                            {canManage && (
                              <SubjectFormDialog
                                departments={departments}
                                mode="edit"
                                professors={professorOptions}
                                subject={{
                                  id: subject.id,
                                  code: subject.code,
                                  name: subject.name,
                                  description: subject.description,
                                  creditHours: subject.creditHours,
                                  attendanceLimit: subject.attendanceLimit,
                                  departmentId: subject.departmentId,
                                  academicTermId: subject.academicTermId,
                                  professorId: subject.professorId,
                                }}
                                terms={terms}
                              />
                            )}
                            <SubjectRowActions
                              canDelete={canDelete}
                              subjectId={subject.id}
                              subjectName={subject.name}
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
