import { ArrowRight, CalendarCheck, FileDown, FileQuestion, TrendingUp, Users } from "lucide-react";
import { getServerSession } from "next-auth";
import { notFound, redirect } from "next/navigation";

import { adminNavItems } from "@/components/admin-nav";
import { AppShell } from "@/components/app-shell";
import { ExcelImportButton, QUESTION_NOUN } from "@/components/excel-import-button";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/primitives";
import { attendanceTone, Progress } from "@/components/ui/progress";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState, QueryErrorState } from "@/components/ui/states";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { RowSelectCheckbox, SelectAllRowsCheckbox } from "@/components/ui/table-selection";
import { authOptions } from "@/auth";
import { databaseErrorMessage } from "@/lib/dashboard-data";
import { formatDate, formatDateTime, formatNumber, formatPercent } from "@/lib/format";
import { questionTypeLabels, roleLabels } from "@/lib/labels";
import { hasPermission } from "@/lib/permissions";
import {
  getAcademicTerms,
  getDepartments,
  getEnrollableStudents,
  getProfessors,
  getSubjectDetail,
  getSubjectForEdit,
} from "@/lib/subjects";

import { EnrollStudentsDialog } from "../enroll-students-dialog";
import { importStudentsForSubjectExcelAction } from "../import-actions";
import { RosterSelectionProvider } from "../roster-selection";
import { importQuestionsForSubjectExcelAction } from "../questions-import-actions";
import { SubjectFormDialog } from "../subject-form-dialog";
import { SubjectRowActions } from "../subject-row-actions";
import { UnenrollStudentButton } from "../unenroll-student-button";

export default async function AdminSubjectDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/sign-in");

  const canManage = hasPermission(session.user.role, "subjects.manage");
  const canDelete = hasPermission(session.user.role, "subjects.delete");
  const canManageQuestions = hasPermission(session.user.role, "questions.manage");

  const { id } = await params;
  const query = await searchParams;
  const enrollQuery = (Array.isArray(query.enrollQuery) ? query.enrollQuery[0] : query.enrollQuery) ?? "";

  const [subject, editData, departments, terms, professors, enrollable] = await Promise.all([
    getSubjectDetail(id).catch((error) => {
      console.error("[subject-detail]", error);
      return undefined;
    }),
    getSubjectForEdit(id).catch(() => null),
    getDepartments().catch(() => []),
    getAcademicTerms().catch(() => []),
    getProfessors().catch(() => []),
    getEnrollableStudents(id, enrollQuery).catch(() => []),
  ]);

  if (subject === undefined) {
    return (
      <AppShell
        navItems={adminNavItems}
        roleLabel={roleLabels.ADMIN}
        subtitle="تعذر تحميل بيانات المادة"
        title="تفاصيل المادة"
        userName={session.user.name ?? "مدير النظام"}
      >
        <QueryErrorState message={databaseErrorMessage} />
      </AppShell>
    );
  }

  if (!subject) notFound();

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
      subtitle={`${subject.departmentName} · ${subject.academicTermName} · ${formatNumber(subject.creditHours)} ساعات`}
      title={subject.name}
      userName={session.user.name ?? "مدير النظام"}
    >
      <div>
        <PageHeader
          actions={
            <>
              <ButtonLink href="/admin/subjects" size="sm" variant="secondary">
                <ArrowRight aria-hidden className="size-4" />
                رجوع للقائمة
              </ButtonLink>
              {canManage && (
                <>
                  <EnrollStudentsDialog
                    students={enrollable}
                    subjectId={subject.id}
                    subjectName={subject.name}
                  />
                  <SubjectFormDialog
                    departments={departments}
                    mode="edit"
                    professors={professorOptions}
                    subject={
                      editData ?? {
                        id: subject.id,
                        code: subject.code,
                        name: subject.name,
                        description: subject.description,
                        creditHours: subject.creditHours,
                        attendanceLimit: subject.attendanceLimit,
                        departmentId: "",
                        academicTermId: "",
                        professorId: null,
                      }
                    }
                    terms={terms}
                  />
                  <SubjectRowActions
                    canDelete={canDelete}
                    subjectId={subject.id}
                    subjectName={subject.name}
                  />
                </>
              )}
            </>
          }
          description={`${subject.code} · حد الحضور ${formatNumber(subject.attendanceLimit)}٪ · أُضيفت في ${formatDate(subject.createdAt)}`}
          title="تفاصيل المادة"
        />

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            hint="طالب مسجل حالياً"
            icon={Users}
            label="عدد الطلاب"
            tone="blue"
            value={formatNumber(subject.students.length)}
          />
          <StatCard
            hint="متوسط حضور الطلاب المسجلين"
            icon={CalendarCheck}
            label="نسبة الحضور"
            tone={attendanceTone(subject.averageAttendance)}
            value={formatPercent(subject.averageAttendance)}
          />
          <StatCard
            hint={`دون حد ${formatNumber(subject.attendanceLimit)}٪`}
            icon={TrendingUp}
            label="حالات الحضور المنخفض"
            tone="rose"
            value={formatNumber(subject.lowAttendanceCount)}
          />
          <StatCard
            hint="امتحانات وأسئلة مرتبطة بالمادة"
            icon={FileQuestion}
            label="متوسط الدرجات"
            tone="amber"
            value={formatPercent(subject.averageScore)}
          />
        </div>

        {subject.description && (
          <Card>
            <CardHeader>
              <CardTitle>وصف المادة</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-7 text-muted">{subject.description}</p>
            </CardContent>
          </Card>
        )}

        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>الطلاب المسجلون ({formatNumber(subject.students.length)})</CardTitle>
          </CardHeader>
          {canManage && (
            <div className="flex items-center justify-end gap-4 border-b border-border px-5 pb-4 sm:px-6">
              <ExcelImportButton
                action={importStudentsForSubjectExcelAction}
                buttonLabel="استيراد من إكسل"
                hint="نزّل القالب، عبّئ بيانات الطلاب، وارفع الملف هنا ليُسجّلوا في هذه المادة تلقائياً."
                hiddenFields={{ subjectId: subject.id }}
              />
              <ButtonLink href="/api/excel/students-template" size="sm" variant="secondary">
                <FileDown aria-hidden className="size-4" />
                قالب إكسل
              </ButtonLink>
            </div>
          )}
          {subject.students.length === 0 ? (
            <CardContent>
              <EmptyState
                description="استخدم زر «تسجيل طلاب» لإضافة طلاب إلى هذه المادة."
                title="لا يوجد طلاب مسجلون"
              />
            </CardContent>
          ) : (
<RosterSelectionProvider
              canManage={canManage}
              studentIds={subject.students.map((student) => student.studentId)}
              subjectId={subject.id}
            >
            <Table>
              <THead>
                <TR>
                  {canManage && (
                    <TH className="w-10">
                      <SelectAllRowsCheckbox label="تحديد كل الطلاب المسجلين" />
                    </TH>
                  )}
                  <TH>الطالب</TH>
                  <TH>الرقم الجامعي</TH>
                  <TH>القسم</TH>
                  <TH>الفرقة</TH>
                  <TH className="w-44">نسبة الحضور</TH>
                  <TH>متوسط الدرجات</TH>
                  <TH>تاريخ التسجيل</TH>
                  {canManage && <TH>إجراء</TH>}
                </TR>
              </THead>
              <TBody>
                {subject.students.map((student) => {
                  const isLow = (student.attendance.percentage ?? 100) < subject.attendanceLimit;

                  return (
                    <TR key={student.enrollmentId}>
                      {canManage && (
                        <TD>
                          <RowSelectCheckbox
                            id={student.studentId}
                            label={`تحديد ${student.fullName}`}
                          />
                        </TD>
                      )}
                      <TD>
                        <span className="font-semibold text-slate-800 dark:text-slate-100">
                          {student.fullName}
                        </span>
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
                      <TD>{formatNumber(student.academicYear)}</TD>
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
                        {isLow && (
                          <Badge className="mt-1.5" tone="danger">
                            دون الحد المسموح
                          </Badge>
                        )}
                      </TD>
                      <TD>{formatPercent(student.averageScore)}</TD>
                      <TD>{formatDate(student.enrolledAt)}</TD>
                      {canManage && (
                        <TD>
                          <div className="flex items-center justify-end">
                            <UnenrollStudentButton
                              studentId={student.studentId}
                              studentName={student.fullName}
                              subjectId={subject.id}
                            />
                          </div>
                        </TD>
                      )}
                    </TR>
                  );
                })}
              </TBody>
            </Table>
            </RosterSelectionProvider>
          )}
        </Card>

        <Card className="overflow-hidden">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>بنك الأسئلة ({formatNumber(subject.questionsCount)})</CardTitle>
          </CardHeader>
          {canManageQuestions && (
            <div className="flex items-center justify-end gap-4 border-b border-border px-5 pb-4 sm:px-6">
              <ExcelImportButton
                action={importQuestionsForSubjectExcelAction}
                buttonLabel="استيراد أسئلة من إكسل"
                hint="نزّل القالب، عبّئ الأسئلة في ورقة نوعها داخل الملف، وارفعه هنا ليُضاف لبنك هذه المادة."
                hiddenFields={{ subjectId: subject.id }}
                kind="questions"
                noun={QUESTION_NOUN}
              />
              <ButtonLink href="/api/excel/questions-template" size="sm" variant="secondary">
                <FileDown aria-hidden className="size-4" />
                قالب إكسل
              </ButtonLink>
            </div>
          )}
          {subject.questionsCount === 0 ? (
            <CardContent>
              <EmptyState
                description="استخدم قالب إكسل لإضافة أسئلة متعددة دفعة واحدة، أو أضف السؤال من صفحة «بنك الأسئلة»."
                title="لا توجد أسئلة في بنك هذه المادة"
              />
            </CardContent>
          ) : (
            <CardContent>
              <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {(["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER", "ESSAY"] as const).map(
                  (type) => (
                    <div key={type}>
                      <dt className="text-xs font-semibold text-muted">
                        {questionTypeLabels[type]}
                      </dt>
                      <dd className="mt-1 text-sm font-bold">
                        {formatNumber(subject.questionsByType[type])}
                      </dd>
                    </div>
                  ),
                )}
              </dl>
            </CardContent>
          )}
        </Card>

        <div className="grid gap-4 xl:grid-cols-2">
          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle>الامتحانات ({formatNumber(subject.exams.length)})</CardTitle>
            </CardHeader>
            {subject.exams.length === 0 ? (
              <CardContent>
                <p className="text-sm text-muted">لا توجد امتحانات مرتبطة بهذه المادة بعد.</p>
              </CardContent>
            ) : (
              <TBody>
                {subject.exams.map((exam) => (
                  <TR key={exam.id}>
                    <TD>
                      <span className="font-semibold text-slate-800 dark:text-slate-100">
                        {exam.title}
                      </span>
                      <p className="text-xs text-slate-500">
                        {formatDateTime(exam.startsAt)} · {formatNumber(exam.totalScore)} درجة
                      </p>
                    </TD>
                    <TD className="text-xs text-slate-500">
                      {formatNumber(exam.attempts)} محاولة · {formatNumber(exam.questions)} سؤال
                    </TD>
                  </TR>
                ))}
              </TBody>
            )}
          </Card>

          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle>آخر المحاضرات</CardTitle>
            </CardHeader>
            {subject.recentSessions.length === 0 ? (
              <CardContent>
                <p className="text-sm text-muted">لا توجد محاضرات مسجلة بعد.</p>
              </CardContent>
            ) : (
              <TBody>
                {subject.recentSessions.map((session) => (
                  <TR key={session.id}>
                    <TD>
                      <span className="font-semibold text-slate-800 dark:text-slate-100">
                        {session.title}
                      </span>
                      <p className="text-xs text-slate-500">{formatDate(session.date)}</p>
                    </TD>
                    <TD className="text-xs text-slate-500">
                      {formatNumber(session.records)} سجل حضور
                    </TD>
                  </TR>
                ))}
              </TBody>
            )}
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>معلومات المادة</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <div>
                <dt className="text-xs font-semibold text-muted">القسم</dt>
                <dd className="mt-1 text-sm font-bold">
                  {subject.departmentName} ({subject.departmentCode})
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-muted">الفصل الدراسي</dt>
                <dd className="mt-1 text-sm font-bold">{subject.academicTermName}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-muted">الأستاذ المسؤول</dt>
                <dd className="mt-1 text-sm font-bold">
                  {subject.professorName ?? <span className="text-muted">غير محدد</span>}
                </dd>
                {subject.professorEmail && (
                  <p className="text-xs text-muted" dir="ltr">
                    {subject.professorEmail}
                  </p>
                )}
              </div>
              <div>
                <dt className="text-xs font-semibold text-muted">عدد الساعات</dt>
                <dd className="mt-1 text-sm font-bold">{formatNumber(subject.creditHours)}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-muted">حد الحضور</dt>
                <dd className="mt-1 text-sm font-bold">
                  {formatNumber(subject.attendanceLimit)}٪
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-muted">عدد الأسئلة</dt>
                <dd className="mt-1 text-sm font-bold">{formatNumber(subject.questionsCount)}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
