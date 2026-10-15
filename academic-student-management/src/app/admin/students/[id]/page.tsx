import {
  ArrowRight,
  BookOpen,
  CalendarCheck,
  FileQuestion,
  TrendingUp,
  UserRound,
} from "lucide-react";
import { getServerSession } from "next-auth";
import { notFound, redirect } from "next/navigation";

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
import { formatDate, formatDateTime, formatNumber, formatPercent, formatScore } from "@/lib/format";
import { attemptStatusLabels, roleLabels } from "@/lib/labels";
import { hasPermission } from "@/lib/permissions";
import { getSpecializationOptions } from "@/lib/specializations";
import { getDepartments, getStudentProfile, type StudentEditData } from "@/lib/students";

import { StudentFormDialog } from "../student-form-dialog";
import { StudentRowActions } from "../student-row-actions";

const attemptTones = {
  IN_PROGRESS: "neutral",
  SUBMITTED: "warning",
  GRADED: "success",
} as const;

export default async function AdminStudentProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/sign-in");

  const canManage = hasPermission(session.user.role, "students.manage");
  const canDelete = hasPermission(session.user.role, "students.delete");

  const { id } = await params;

  const [profile, departments, specializations] = await Promise.all([
    getStudentProfile(id).catch((error) => {
      console.error("[student-profile]", error);
      return undefined;
    }),
    getDepartments().catch(() => []),
    getSpecializationOptions().catch(() => []),
  ]);

  if (profile === undefined) {
    return (
      <AppShell
        navItems={adminNavItems}
        roleLabel={roleLabels.ADMIN}
        subtitle="تعذر تحميل بيانات الطالب"
        title="ملف الطالب"
        userName={session.user.name ?? "مدير النظام"}
      >
        <QueryErrorState message={databaseErrorMessage} />
      </AppShell>
    );
  }

  if (!profile) notFound();

  const editData: StudentEditData = {
    id: profile.id,
    serial: profile.serial,
    fullName: profile.fullName,
    email: profile.email,
    phone: profile.phone,
    universityId: profile.universityId,
    academicYear: profile.academicYear,
    departmentId: profile.departmentId,
    specializationId: profile.specializationId,
    isActive: profile.isActive,
  };

  return (
    <AppShell
      navItems={adminNavItems}
      roleLabel={roleLabels.ADMIN}
      subtitle={`${profile.departmentName} · الفرقة ${formatNumber(profile.academicYear)} · الرقم الجامعي ${profile.universityId}`}
      title={profile.fullName}
      userName={session.user.name ?? "مدير النظام"}
    >
      <div>
        <PageHeader
          actions={
            <>
              <ButtonLink href="/admin/students" size="sm" variant="secondary">
                <ArrowRight aria-hidden className="size-4" />
                رجوع للقائمة
              </ButtonLink>
              {canManage && (
                <>
                  <StudentFormDialog
                    departments={departments}
                    mode="edit"
                    specializations={specializations}
                    student={editData}
                  />
                  <StudentRowActions canDelete={false} student={editData} />
                </>
              )}
            </>
          }
          description={`${profile.email} · حساب ${profile.isActive ? "نشط" : "موقوف"}`}
          title="ملف الطالب"
        />

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            hint="متوسط نسب المواد المسجلة"
            icon={CalendarCheck}
            label="نسبة الحضور العامة"
            tone={attendanceTone(profile.averageAttendance)}
            value={formatPercent(profile.averageAttendance)}
          />
          <StatCard
            hint="من الامتحانات المصححة"
            icon={TrendingUp}
            label="متوسط الدرجات"
            tone="amber"
            value={formatPercent(profile.averageScore)}
          />
          <StatCard
            hint="المواد المسجل بها"
            icon={BookOpen}
            label="عدد المواد"
            tone="blue"
            value={formatNumber(profile.subjects.length)}
          />
          <StatCard
            hint={`آخر دخول ${profile.lastLoginAt ? formatDate(profile.lastLoginAt) : "—"}`}
            icon={UserRound}
            label="حالة الحساب"
            tone={profile.isActive ? "emerald" : "rose"}
            value={profile.isActive ? "نشط" : "موقوف"}
          />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>المواد ونسب الحضور</CardTitle>
        </CardHeader>
        {profile.subjects.length === 0 ? (
          <CardContent>
            <EmptyState description="لم يتم تسجيل الطالب في أي مادة بعد." title="لا توجد مواد مسجلة" />
          </CardContent>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>المادة</TH>
                <TH>الكود</TH>
                <TH>الأستاذ</TH>
                <TH>حضور / غياب</TH>
                <TH className="w-48">النسبة</TH>
              </TR>
            </THead>
            <TBody>
              {profile.subjects.map((subject) => (
                <TR key={subject.id}>
                  <TD className="font-medium text-slate-800 dark:text-slate-100">{subject.name}</TD>
                  <TD>
                    <span className="text-slate-500" dir="ltr">
                      {subject.code}
                    </span>
                  </TD>
                  <TD>{subject.professorName ?? "—"}</TD>
                  <TD>
                    <span className="text-emerald-600">{formatNumber(subject.attendance.present)}</span>
                    <span className="mx-1 text-slate-400">/</span>
                    <span className="text-rose-600">{formatNumber(subject.attendance.absent)}</span>
                    <span className="mx-1 text-slate-400">·</span>
                    <span className="text-amber-600">
                      {formatNumber(subject.attendance.excused)} بعذر
                    </span>
                  </TD>
                  <TD>
                    <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
                      <span className="text-slate-500">
                        الحد {formatPercent(subject.attendanceLimit, 0)}
                      </span>
                      <span className="font-semibold text-slate-700 dark:text-slate-200">
                        {formatPercent(subject.attendance.percentage)}
                      </span>
                    </div>
                    <Progress
                      tone={attendanceTone(subject.attendance.percentage, subject.attendanceLimit)}
                      value={subject.attendance.percentage}
                    />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileQuestion aria-hidden className="size-5" />
              نتائج الامتحانات
            </CardTitle>
          </CardHeader>
          {profile.attempts.length === 0 ? (
            <CardContent>
              <EmptyState description="لا توجد محاولات امتحانات مسجلة لهذا الطالب." title="لا توجد نتائج" />
            </CardContent>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>الامتحان</TH>
                  <TH>المادة</TH>
                  <TH>الدرجة</TH>
                  <TH>النسبة</TH>
                  <TH>الحالة</TH>
                  <TH>تاريخ التسليم</TH>
                </TR>
              </THead>
              <TBody>
                {profile.attempts.map((attempt) => (
                  <TR key={attempt.id}>
                    <TD className="font-medium text-slate-800 dark:text-slate-100">
                      {attempt.examTitle}
                    </TD>
                    <TD>{attempt.subjectName}</TD>
                    <TD>
                      {formatScore(attempt.score)} / {formatScore(attempt.totalScore, 0)}
                    </TD>
                    <TD>{formatPercent(attempt.percentage)}</TD>
                    <TD>
                      <Badge tone={attemptTones[attempt.status]}>
                        {attemptStatusLabels[attempt.status]}
                      </Badge>
                    </TD>
                    <TD>{attempt.submittedAt ? formatDate(attempt.submittedAt) : "—"}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>بيانات الحساب</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <InfoRow label="الاسم الكامل" value={profile.fullName} />
            <InfoRow label="البريد الإلكتروني" value={profile.email} ltr />
            <InfoRow label="المسلسل" value={profile.serial ?? "—"} ltr />
            <InfoRow label="الرقم الجامعي" value={profile.universityId} ltr />
            <InfoRow label="الهاتف" value={profile.phone ?? "—"} ltr />
            <InfoRow label="القسم" value={`${profile.departmentName} (${profile.departmentCode})`} />
            <InfoRow
              label="التخصص"
              value={profile.specializationName ? `${profile.specializationName} (${profile.specializationCode})` : "—"}
            />
            <InfoRow label="الفرقة" value={formatNumber(profile.academicYear)} />
            <InfoRow label="تاريخ التسجيل" value={formatDate(profile.createdAt)} />
            <InfoRow label="آخر دخول" value={profile.lastLoginAt ? formatDateTime(profile.lastLoginAt) : "لم يسجل دخولاً"} />
            <div className="flex items-center justify-between">
              <span className="text-slate-500">الحالة</span>
              <Badge tone={profile.isActive ? "success" : "danger"}>
                {profile.isActive ? "نشط" : "موقوف"}
              </Badge>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function InfoRow({ label, value, ltr }: { label: string; value: string; ltr?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="shrink-0 text-slate-500">{label}</span>
      <span
        className="truncate font-medium text-slate-800 dark:text-slate-100"
        dir={ltr ? "ltr" : undefined}
      >
        {value}
      </span>
    </div>
  );
}
