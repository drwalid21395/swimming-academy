import { Layers, Users } from "lucide-react";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { adminNavItems } from "@/components/admin-nav";
import { AppShell } from "@/components/app-shell";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/primitives";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState, QueryErrorState } from "@/components/ui/states";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { authOptions } from "@/auth";
import { databaseErrorMessage } from "@/lib/dashboard-data";
import { formatNumber } from "@/lib/format";
import { roleLabels } from "@/lib/labels";
import { hasPermission } from "@/lib/permissions";
import { listSpecializations } from "@/lib/specializations";
import { getDepartments } from "@/lib/students";

import { SpecializationFormDialog } from "./specialization-form-dialog";
import { SpecializationRowActions } from "./specialization-row-actions";

export default async function AdminSpecializationsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/sign-in");

  const canManage = hasPermission(session.user.role, "specializations.manage");
  const canDelete = hasPermission(session.user.role, "specializations.delete");

  const [rows, departments] = await Promise.all([
    listSpecializations().catch((cause) => {
      console.error("[specializations]", cause);
      return null;
    }),
    getDepartments().catch(() => []),
  ]);

  const assignedStudents = rows?.reduce((sum, row) => sum + row.studentsCount, 0) ?? 0;
  const coveredDepartments = new Set(rows?.map((row) => row.departmentId) ?? []).size;

  return (
    <AppShell
      navItems={adminNavItems}
      roleLabel={roleLabels.ADMIN}
      subtitle="تخصصات الأقسام وتخصيص طلاب الفرقة الرابعة"
      title="التخصصات"
      userName={session.user.name ?? "مدير النظام"}
    >
      {!rows ? (
        <QueryErrorState message={databaseErrorMessage} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard
              hint="إجمالي التخصصات المسجلة"
              icon={Layers}
              label="عدد التخصصات"
              tone="blue"
              value={formatNumber(rows.length)}
            />
            <StatCard
              hint="أقسام تم تعريف تخصصات لها"
              icon={Layers}
              label="أقسام مغطاة"
              tone="violet"
              value={formatNumber(coveredDepartments)}
            />
            <StatCard
              hint="طلاب تم تخصيصهم لتخصص"
              icon={Users}
              label="طلاب مخصصون"
              tone="emerald"
              value={formatNumber(assignedStudents)}
            />
          </div>

          <div>
            <PageHeader
              actions={
                canManage ? (
                  <SpecializationFormDialog departments={departments} mode="create" />
                ) : null
              }
              description="التخصص اختياري للطالب، ومفيد بشكل أساسي لطلبة الفرقة الرابعة فما فوق."
              title="قائمة التخصصات"
            />

            <Card className="overflow-hidden">
              {rows.length === 0 ? (
                <CardContent>
                  <EmptyState
                    description="عرّف تخصصات الأقسام أولاً لتظهر في قائمة التخصص عند إضافة أو تعديل طالب."
                    title="لا توجد تخصصات مسجلة"
                  />
                </CardContent>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>التخصص</TH>
                      <TH>القسم</TH>
                      <TH>عدد الطلاب</TH>
                      <TH>إجراءات</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {rows.map((row) => (
                      <TR key={row.id}>
                        <TD>
                          <span className="font-semibold text-slate-800 dark:text-slate-100">
                            {row.name}
                          </span>
                          <p className="text-xs text-slate-500" dir="ltr">
                            {row.code}
                          </p>
                        </TD>
                        <TD>
                          {row.departmentName}
                          <span className="text-xs text-slate-500"> ({row.departmentCode})</span>
                        </TD>
                        <TD>{formatNumber(row.studentsCount)}</TD>
                        <TD>
                          <SpecializationRowActions
                            canDelete={canDelete}
                            canManage={canManage}
                            departments={departments}
                            specialization={row}
                          />
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>إرشادات</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="list-inside list-disc space-y-1.5 text-sm text-muted">
                <li>التخصص مرتبط بقسم واحد، ولا يمكن استخدام نفس الاسم أو الكود في قسمين.</li>
                <li>
                  عند إضافة أو تعديل طالب، اختر القسم أولاً ثم سيظهر قائمة التخصصات الخاصة به.
                </li>
                <li>لا يمكن حذف تخصص مرتبط بطلاب؛ انقل الطلاب لتخصص آخر أولاً.</li>
                <li>
                  <ButtonLink href="/admin/students" size="sm" variant="secondary">
                    الذهاب لإدارة الطلاب
                  </ButtonLink>
                </li>
              </ul>
            </CardContent>
          </Card>
        </>
      )}
    </AppShell>
  );
}
