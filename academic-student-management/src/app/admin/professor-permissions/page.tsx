import {
  BookOpen,
  CalendarCheck,
  KeyRound,
  Library,
  Newspaper,
  ScrollText,
  ShieldCheck,
  ShieldOff,
  UserCog,
  UserRoundCog,
  type LucideIcon,
} from "lucide-react";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { adminNavItems } from "@/components/admin-nav";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/primitives";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState, QueryErrorState } from "@/components/ui/states";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { authOptions } from "@/auth";
import type { AppRole } from "@/lib/authorization";
import { listDepartments } from "@/lib/departments";
import { formatDate, formatNumber } from "@/lib/format";
import { roleLabels } from "@/lib/labels";
import { hasPermission } from "@/lib/permissions";
import {
  listProfessorPermissionMatrix,
  PROFESSOR_PERMISSION_CATALOG,
  type ProfessorPermissionKey,
} from "@/lib/professor-permissions";

import { PermissionToggle, SubjectScopeDialog } from "./professor-permission-controls";
import { ProfessorFormDialog } from "./professor-form-dialog";
import { ProfessorRowActions } from "./professor-row-actions";

const permissionIcons = {
  ATTENDANCE_RECORD: CalendarCheck,
  SUBJECTS_MANAGE: BookOpen,
  QUESTIONS_MANAGE: Library,
  EXAMS_MANAGE: ScrollText,
  RESULTS_VIEW: ShieldCheck,
  ANNOUNCEMENTS_PUBLISH: Newspaper,
} as const satisfies Record<ProfessorPermissionKey, LucideIcon>;

const permissionOptions = PROFESSOR_PERMISSION_CATALOG.map((permission) => ({
  key: permission.key,
  label: permission.label,
  description: permission.description,
}));

export default async function ProfessorPermissionsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; new?: string; edit?: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/sign-in");
  if (!hasPermission(session.user.role as AppRole, "professors.permissions")) {
    redirect("/unauthorized");
  }

  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q : "";
  const editingId = typeof params.edit === "string" ? params.edit : "";

  const matrix = await listProfessorPermissionMatrix(query).catch((error) => {
    console.error("[professor-permissions]", error);
    return null;
  });

  const departments = await listDepartments().catch((error) => {
    console.error("[professor-permissions]", error);
    return [];
  });

  if (!matrix) {
    return (
      <AppShell
        navItems={adminNavItems}
        roleLabel={roleLabels.ADMIN}
        subtitle="منح صلاحيات الدكاترة وسحبها"
        title="صلاحيات الدكاترة"
        userName={session.user.name ?? "مدير النظام"}
      >
        <QueryErrorState message="تعّر تحميل بيانات الصلاحيات. حاول مرة أخرى." />
      </AppShell>
    );
  }

  const { rows, stats, subjectOptions, supervisorOptions } = matrix;

  // Assistants may only ever hold a subset of their supervisor's subjects, so the
  // inline scope editor is filtered the same way the form dialog is.
  function scopeOptionsFor(kind: "PROFESSOR" | "ASSISTANT", supervisorId: string | null) {
    if (kind !== "ASSISTANT" || !supervisorId) return subjectOptions;
    const supervisor = supervisorOptions.find((option) => option.professorId === supervisorId);
    if (!supervisor) return [];
    return subjectOptions.filter((subject) => supervisor.subjectIds.includes(subject.id));
  }

  return (
    <AppShell
      navItems={adminNavItems}
      roleLabel={roleLabels.ADMIN}
      subtitle="أنت فقط من يمكنه منح أو سحب صلاحيات أعضاء هيئة التدريس والمعاونة"
      title="صلاحيات الدكاترة"
      userName={session.user.name ?? "مدير النظام"}
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          hint="عضو هيئة تدريس"
          icon={UserCog}
          label="عدد الدكاترة"
          tone="blue"
          value={formatNumber(stats.professors)}
        />
        <StatCard
          hint="تحت إشراف دكتور"
          icon={UserRoundCog}
          label="أعضاء المعاونة"
          tone="rose"
          value={formatNumber(stats.assistants)}
        />
        <StatCard
          hint="مادة مرتبطة بدكتور"
          icon={BookOpen}
          label="المواد المسندة"
          tone="violet"
          value={formatNumber(stats.subjects)}
        />
        <StatCard
          hint="منح مسجّل في النظام"
          icon={KeyRound}
          label="إجمالي الصلاحيات"
          tone="emerald"
          value={formatNumber(stats.grants)}
        />
        <StatCard
          hint="لا يستطيعون سوى الحضور ولوحة التحكم"
          icon={ShieldOff}
          label="بلا أي صلاحية"
          tone="amber"
          value={formatNumber(stats.fullyLocked)}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>الصلاحيات المتاحة</CardTitle>
          <CardDescription>
            كل صلاحية غير ممنوحة تُرفض تلقائياً: لا تظهر في قائمة الدكتور، ولا يمكن تنفيذ أي إجراء
            حتى لو تم استدعاؤه مباشرة.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {PROFESSOR_PERMISSION_CATALOG.map((permission) => {
              const Icon = permissionIcons[permission.key];

              return (
                <li
                  className="rounded-2xl bg-[var(--glass-bg)] p-4 ring-1 ring-inset ring-[var(--glass-border)]"
                  key={permission.key}
                >
                  <div className="flex items-start gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-500/12 text-brand-700 dark:text-brand-200">
                      <Icon aria-hidden className="size-5" />
                    </span>
                    <div className="min-w-0">
                      <p className="font-bold text-[var(--app-text)]">{permission.label}</p>
                      <p className="mt-1 text-xs leading-6 text-muted">{permission.description}</p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeader
          description={`${formatNumber(rows.length)} عضو هيئة تدريس`}
          title="حسابات الدكاترة"
        />
        <ProfessorFormDialog
          departments={departments}
          initiallyOpen={params.new === "1"}
          mode="create"
          permissionOptions={permissionOptions}
          subjectOptions={subjectOptions}
          supervisorOptions={supervisorOptions}
        />
      </div>

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <CardContent>
            <EmptyState
              description="لا يوجد أعضاء هيئة تدريس مطابقون للبحث الحالي. ابدأ بإضافة دكتور جديد."
              title="لا توجد نتائج"
            />
          </CardContent>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>عضو هيئة التدريس</TH>
                <TH>القسم</TH>
                <TH className="text-center">عدد الصلاحيات</TH>
                {PROFESSOR_PERMISSION_CATALOG.map((permission) => (
                  <TH className="text-center" key={permission.key}>
                    {permission.label}
                  </TH>
                ))}
                <TH>نطاق المواد</TH>
                <TH>إجراءات</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((row) => {
                const granted = new Set(row.grants.map((grant) => grant.key));

                return (
                  <TR key={row.professorId}>
                    <TD>
                      <p className="font-semibold text-[var(--app-text)]">{row.fullName}</p>
                      <p className="text-xs text-muted" dir="ltr">
                        {row.email}
                      </p>
                      <p className="text-xs text-muted" dir="ltr">
                        {row.employeeCode}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {row.kind === "ASSISTANT" ? (
                          <>
                            <Badge tone="info">عضو هيئة معاونة</Badge>
                            {row.supervisorName && (
                              <Badge tone="neutral">تحت إشراف: {row.supervisorName}</Badge>
                            )}
                          </>
                        ) : (
                          <Badge tone="neutral">دكتور</Badge>
                        )}
                        {!row.isActive && <Badge tone="danger">حساب موقوف</Badge>}
                      </div>
                    </TD>
                    <TD>
                      <p className="text-sm">{row.departmentName}</p>
                      <p className="text-xs text-muted">{formatNumber(row.subjectIds.length)} مادة</p>
                    </TD>
                    <TD className="text-center">
                      <Badge tone={granted.size === 0 ? "danger" : granted.size === PROFESSOR_PERMISSION_CATALOG.length ? "success" : "warning"}>
                        {formatNumber(granted.size)} / {formatNumber(PROFESSOR_PERMISSION_CATALOG.length)}
                      </Badge>
                    </TD>
                    {PROFESSOR_PERMISSION_CATALOG.map((permission) => (
                      <TD className="text-center" key={permission.key}>
                        <div className="flex justify-center">
                          <PermissionToggle
                            granted={granted.has(permission.key)}
                            permissionKey={permission.key}
                            permissionLabel={permission.label}
                            professorId={row.professorId}
                          />
                        </div>
                      </TD>
                    ))}
                    <TD>
                      <div className="flex flex-col items-end gap-2">
                        <SubjectScopeDialog
                          professor={{
                            professorId: row.professorId,
                            fullName: row.fullName,
                            subjectIds: row.subjectIds,
                            subjectNames: row.subjectNames,
                          }}
                          subjectOptions={scopeOptionsFor(row.kind, row.supervisorId)}
                        />
                        {row.grants.length > 0 && (
                          <p className="max-w-56 text-end text-xs text-muted">
                            آخر منح: {formatDate(row.grants[0].grantedAt)}
                            {row.grants[0].grantedByName
                              ? ` بواسطة ${row.grants[0].grantedByName}`
                              : ""}
                          </p>
                        )}
                      </div>
                    </TD>
                    <TD>
                      <ProfessorRowActions
                        departments={departments}
                        initiallyOpenEdit={editingId === row.professorId}
                        permissionOptions={permissionOptions}
                        professor={{
                          id: row.professorId,
                          kind: row.kind,
                          supervisorId: row.supervisorId,
                          supervisorName: row.supervisorName,
                          fullName: row.fullName,
                          email: row.email,
                          employeeCode: row.employeeCode,
                          phone: row.phone,
                          departmentId: row.departmentId,
                          isActive: row.isActive,
                          subjectIds: row.subjectIds,
                          permissionKeys: [...granted],
                        }}
                        subjectOptions={subjectOptions}
                        supervisorOptions={supervisorOptions}
                      />
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>
    </AppShell>
  );
}
