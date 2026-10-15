import {
  CalendarCheck,
  FileDown,
  GraduationCap,
  TriangleAlert,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { adminNavItems } from "@/components/admin-nav";
import { AppShell } from "@/components/app-shell";
import { ExcelImportButton } from "@/components/excel-import-button";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/primitives";
import { attendanceTone, Progress } from "@/components/ui/progress";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState, QueryErrorState } from "@/components/ui/states";
import { SortableTH } from "@/components/ui/sortable-th";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { authOptions } from "@/auth";
import { databaseErrorMessage } from "@/lib/dashboard-data";
import { formatNumber, formatPercent } from "@/lib/format";
import { roleLabels } from "@/lib/labels";
import { hasPermission } from "@/lib/permissions";
import { getSpecializationOptions } from "@/lib/specializations";
import { getSubjectPickerOptions } from "@/lib/subjects";
import {
  nextStudentSort,
  resolveStudentSort,
  type StudentSortField,
} from "@/lib/student-sort";
import {
  getDepartments,
  listStudents,
  MAX_STUDENT_SCAN,
  parseStudentFilters,
  type StudentFilters,
  type StudentSearchParams,
} from "@/lib/students";

import { ExportStudentsButton } from "./export-students-button";
import { importStudentsExcelAction } from "./import-actions";
import { StudentFilters as Filters } from "./student-filters";
import { StudentFormDialog } from "./student-form-dialog";
import { StudentRowActions } from "./student-row-actions";
import {
  SelectAllStudentsCheckbox,
  StudentSelectCheckbox,
  StudentSelectionProvider,
} from "./student-selection";

function filterHref(filters: StudentFilters, override?: Partial<StudentFilters>) {
  const params = new URLSearchParams();

  const merged: StudentFilters = { ...filters, ...override };

  if (merged.query) params.set("query", merged.query);
  if (merged.departmentId) params.set("departmentId", merged.departmentId);
  if (merged.academicYear) params.set("academicYear", merged.academicYear);
  if (merged.attendanceState && merged.attendanceState !== "all") {
    params.set("attendanceState", merged.attendanceState);
  }
  if (merged.sortBy) params.set("sortBy", merged.sortBy);
  if (merged.sortDir === "desc") params.set("sortDir", "desc");
  // The page resets on any new filter, so `page` is only carried when the caller
  // is the pager itself.
  if (merged.page && merged.page > 1) params.set("page", String(merged.page));
  if (merged.pageSize) params.set("pageSize", String(merged.pageSize));

  const search = params.toString();
  return search ? `/admin/students?${search}` : "/admin/students";
}

export default async function AdminStudentsPage({
  searchParams,
}: {
  searchParams: Promise<StudentSearchParams>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/sign-in");

  const canManage = hasPermission(session.user.role, "students.manage");
  const canDelete = hasPermission(session.user.role, "students.delete");
  // Enrolling a student into a subject is a subject write, so it follows the
  // `subjects.manage` gate rather than the student gates above.
  const canEnroll = hasPermission(session.user.role, "subjects.manage");

  const filters = parseStudentFilters(await searchParams);

  const [result, departments, specializations, subjects] = await Promise.all([
    listStudents(filters).catch((error) => {
      console.error("[students]", error);
      return null;
    }),
    getDepartments().catch(() => []),
    getSpecializationOptions().catch(() => []),
    canEnroll ? getSubjectPickerOptions().catch(() => []) : Promise.resolve([]),
  ]);

  const sort = resolveStudentSort(filters.sortBy, filters.sortDir);

  const sortLink = (field: StudentSortField) => {
    const next = nextStudentSort(sort, field);
    // A new order makes the current page number meaningless, so go back to the
    // first page rather than showing an arbitrary slice of the sorted list.
    return filterHref(filters, { sortBy: next.field, sortDir: next.dir, page: undefined });
  };

  return (
    <AppShell
      navItems={adminNavItems}
      roleLabel={roleLabels.ADMIN}
      subtitle="بحث وتصفية وإدارة بيانات الطلاب وحساباتهم"
      title="إدارة الطلاب"
      userName={session.user.name ?? "مدير النظام"}
    >
      {!result ? (
        <QueryErrorState message={databaseErrorMessage} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              hint="إجمالي الطلاب في النظام"
              icon={GraduationCap}
              label="عدد الطلاب"
              tone="blue"
              value={formatNumber(result.totalStudents)}
            />
            <StatCard
              hint="متوسط النسب المسجلة"
              icon={CalendarCheck}
              label="متوسط الحضور"
              tone={attendanceTone(result.averageAttendance)}
              value={formatPercent(result.averageAttendance)}
            />
            <StatCard
              hint="يحتاجون إلى متابعة"
              icon={TriangleAlert}
              label="حضور أقل من 75٪"
              tone="rose"
              value={formatNumber(result.lowAttendanceCount)}
            />
            <StatCard
              hint={`${formatNumber(result.totalSubjects)} مادة دراسية`}
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
                departments={departments}
                initial={{
                  query: filters.query ?? "",
                  departmentId: filters.departmentId ?? "",
                  academicYear: filters.academicYear ?? "",
                  attendanceState: filters.attendanceState ?? "all",
                }}
              />
            </CardContent>
          </Card>

          <div>
            <PageHeader
              actions={
                <>
                  <ExportStudentsButton rows={result.exportRows} />
                  {canManage && (
                    <>
                      <ButtonLink
                        href="/api/excel/students-template"
                        size="sm"
                        variant="secondary"
                      >
                        <FileDown aria-hidden className="size-4" />
                        قالب إكسل
                      </ButtonLink>
                      <ExcelImportButton
                        action={importStudentsExcelAction}
                        buttonLabel="استيراد من إكسل"
                        hint="نزّل القالب، عبّئ بياناتك، ثم ارفعه هنا."
                      />
                    </>
                  )}
                  {canManage && (
                    <StudentFormDialog
                      departments={departments}
                      mode="create"
                      specializations={specializations}
                    />
                  )}
                </>
              }
              description={`${formatNumber(result.total)} طالب مطابق للفلاتر الحالية`}
              title="قائمة الطلاب"
            />

            <StudentSelectionProvider
              canDelete={canDelete}
              canEnroll={canEnroll}
              filters={{
                query: filters.query,
                departmentId: filters.departmentId,
                academicYear: filters.academicYear,
                attendanceState: filters.attendanceState,
              }}
              isTruncated={result.isTruncated}
              matchingCount={result.total}
              students={result.rows.map((student) => ({
                id: student.id,
                fullName: student.fullName,
                universityId: student.universityId,
              }))}
              subjects={subjects}
            >
              <Card className="overflow-hidden">
                {result.rows.length === 0 ? (
                  <CardContent>
                    <EmptyState
                      description="جرّب تعديل الفلاتر أو أضف طالباً جديداً للبدء."
                      title="لا يوجد طلاب مطابقون"
                    />
                  </CardContent>
                ) : (
                  <Table containerClassName="max-h-[70dvh] overflow-y-auto">
                    <THead className="sticky top-0 z-20">
                    <TR>
                      {(canDelete || canEnroll) && (
                        <TH className="w-10">
                          <SelectAllStudentsCheckbox />
                        </TH>
                      )}
                      <SortableTH active={sort.field === "serial"} dir={sort.dir} href={sortLink("serial")}>
                        المسلسل
                      </SortableTH>
                      <SortableTH active={sort.field === "fullName"} dir={sort.dir} href={sortLink("fullName")}>
                        الطالب
                      </SortableTH>
                      <SortableTH
                        active={sort.field === "universityId"}
                        dir={sort.dir}
                        href={sortLink("universityId")}
                      >
                        الرقم الجامعي
                      </SortableTH>
                      <SortableTH
                        active={sort.field === "department"}
                        dir={sort.dir}
                        href={sortLink("department")}
                      >
                        القسم
                      </SortableTH>
                      <SortableTH
                        active={sort.field === "specialization"}
                        dir={sort.dir}
                        href={sortLink("specialization")}
                      >
                        التخصص
                      </SortableTH>
                      <SortableTH
                        active={sort.field === "academicYear"}
                        dir={sort.dir}
                        href={sortLink("academicYear")}
                      >
                        الفرقة
                      </SortableTH>
                      <SortableTH
                        active={sort.field === "subjectsCount"}
                        dir={sort.dir}
                        href={sortLink("subjectsCount")}
                      >
                        المواد
                      </SortableTH>
                      <TH className="w-44">نسبة الحضور</TH>
                      <TH>متوسط الدرجات</TH>
                      <SortableTH
                        active={sort.field === "isActive"}
                        dir={sort.dir}
                        href={sortLink("isActive")}
                      >
                        الحالة
                      </SortableTH>
                      <TH>إجراءات</TH>
                    </TR>
                  </THead>
                    <TBody>
                      {result.rows.map((student) => (
                        <TR key={student.id}>
                          {(canDelete || canEnroll) && (
                            <TD>
                              <StudentSelectCheckbox studentId={student.id} />
                            </TD>
                          )}
                          {/* The serial the student carries in the uploaded roster, not the row
                              position. It is blank until a file supplies one. */}
                          <TD className="text-slate-500 dark:text-slate-400" dir="ltr">
                            {student.serial ?? "—"}
                          </TD>
                        <TD>
                          <Link
                            className="font-semibold text-slate-800 hover:text-brand-700 dark:text-slate-100"
                            href={`/admin/students/${student.id}`}
                          >
                            {student.fullName}
                          </Link>
                          <p className="text-xs text-slate-500" dir="ltr">
                            {student.email}
                          </p>
                        </TD>
                        <TD>
                          <span className="text-slate-600 dark:text-slate-300" dir="ltr">
                            {student.universityId}
                          </span>
                        </TD>
                        <TD>{student.departmentName}</TD>
                        <TD>
                          {student.specializationName ? (
                            student.specializationName
                          ) : (
                            <span className="text-sm text-slate-500">—</span>
                          )}
                        </TD>
                        <TD>{formatNumber(student.academicYear)}</TD>
                        <TD>{formatNumber(student.subjectsCount)}</TD>
                        <TD>
                          <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
                            <span className="text-slate-500">
                              {formatNumber(student.attendance.present)} /{" "}
                              {formatNumber(student.attendance.total)}
                            </span>
                            <span className="font-semibold text-slate-700 dark:text-slate-200">
                              {formatPercent(student.attendance.percentage)}
                            </span>
                          </div>
                          <Progress
                            size="sm"
                            tone={attendanceTone(student.attendance.percentage)}
                            value={student.attendance.percentage}
                          />
                        </TD>
                        <TD>{formatPercent(student.averageScore)}</TD>
                        <TD>
                          <Badge tone={student.isActive ? "success" : "danger"}>
                            {student.isActive ? "نشط" : "موقوف"}
                          </Badge>
                        </TD>
                        <TD>
                          <div className="flex items-center justify-end gap-2">
                            <ButtonLink
                              href={`/admin/students/${student.id}`}
                              size="sm"
                              variant="ghost"
                            >
                              عرض
                            </ButtonLink>
                            {canManage && (
                              <StudentFormDialog
                                departments={departments}
                                mode="edit"
                                specializations={specializations}
                                student={student}
                              />
                            )}
                            <StudentRowActions canDelete={canDelete} student={student} />
                          </div>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
              </Card>
            </StudentSelectionProvider>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-500">
              <p>
                {formatNumber(result.total)} طالب مطابق للفلاتر · صفحة{" "}
                {formatNumber(result.page)} من {formatNumber(result.totalPages)}
              </p>

              {result.totalPages > 1 && (
                <nav
                  aria-label="تنقل بين صفحات الطلاب"
                  className="flex flex-wrap items-center gap-2"
                >
                  {/* An anchor has no `disabled`, so an unreachable page renders as a
                      muted span instead of a link that would only reload page 1. */}
                  {result.page <= 1 ? (
                    <span
                      aria-disabled
                      className="inline-flex h-9 items-center justify-center rounded-xl border border-[var(--glass-border)] px-3 text-xs font-bold opacity-50"
                    >
                      السابق
                    </span>
                  ) : (
                    <ButtonLink
                      href={filterHref(filters, { page: result.page - 1 })}
                      size="sm"
                      variant="secondary"
                    >
                      السابق
                    </ButtonLink>
                  )}

                  <span className="px-1 text-xs">
                    {formatNumber(result.page)} / {formatNumber(result.totalPages)}
                  </span>

                  {result.page >= result.totalPages ? (
                    <span
                      aria-disabled
                      className="inline-flex h-9 items-center justify-center rounded-xl border border-[var(--glass-border)] px-3 text-xs font-bold opacity-50"
                    >
                      التالي
                    </span>
                  ) : (
                    <ButtonLink
                      href={filterHref(filters, { page: result.page + 1 })}
                      size="sm"
                      variant="secondary"
                    >
                      التالي
                    </ButtonLink>
                  )}
                </nav>
              )}
            </div>

            {result.isTruncated && (
              <p className="mt-3 text-xs text-amber-600">
                يوجد أكثر من {formatNumber(MAX_STUDENT_SCAN)} طالب، يتم عرض أول{" "}
                {formatNumber(MAX_STUDENT_SCAN)} فقط. استخدم البحث أو الفلاتر لتضييق النطاق.
              </p>
            )}
          </div>
        </>
      )}
    </AppShell>
  );
}
