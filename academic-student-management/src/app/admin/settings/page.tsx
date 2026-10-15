import { CalendarRange, KeyRound, Palette, Settings2 } from "lucide-react";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { adminNavItems } from "@/components/admin-nav";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, QueryErrorState } from "@/components/ui/states";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { authOptions } from "@/auth";
import type { AppRole } from "@/lib/authorization";
import { formatDate, formatNumber } from "@/lib/format";
import { roleLabels } from "@/lib/labels";
import { hasPermission } from "@/lib/permissions";
import { getTermEditData, listTerms } from "@/lib/settings";
import { getSiteBranding } from "@/lib/site-branding";

import { BrandingForm } from "./branding-form";
import { PasswordForm } from "./password-form";
import { TermFormDialog } from "./term-form-dialog";
import { TermRowActions } from "./term-row-actions";

export default async function SettingsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/sign-in");

  const canManage = hasPermission(session.user.role as AppRole, "settings.manage");
  if (!canManage) redirect("/unauthorized");

  const terms = await listTerms();
  const branding = await getSiteBranding();
  const editData = canManage ? await Promise.all((terms.ok ? terms.data : []).map((term) => getTermEditData(term.id))) : [];

  return (
    <AppShell
      navItems={adminNavItems}
      roleLabel={roleLabels.ADMIN}
      subtitle="ضبط الفصول الدراسية وتأمين حساب مدير النظام."
      title="الإعدادات"
      userName={session.user.name ?? "مدير النظام"}
    >
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette aria-hidden className="size-5" />
            هوية المنصة
          </CardTitle>
          <CardDescription>
            اسم المنصة وشعارها. يظهران في كل الصفحات وفي تبويب المتصفح، ويمكن تغيير الشعار أيضاً بالضغط
            على الأيقونة بجانب اسم المنصة في القائمة الجانبية.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {canManage ? (
            <BrandingForm siteLogo={branding.siteLogo} siteName={branding.siteName} />
          ) : (
            <EmptyState description="لا تملك صلاحية تعديل هوية المنصة." title="صلاحية غير متاحة" />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <CalendarRange aria-hidden className="size-5" />
              الفصول الدراسية
            </CardTitle>
            <CardDescription>
              الفصل الحالي هو النشط في النظام، وتظهر مواد كل فصل ضمن صفحات المواد والتسجيل.
            </CardDescription>
          </div>
          {canManage && <TermFormDialog mode="create" />}
        </CardHeader>

        <CardContent>
          {!terms.ok ? (
            <QueryErrorState message={terms.message} />
          ) : terms.data.length === 0 ? (
            <EmptyState
              description="أضف الفصل الدراسي الأول لتتمكن من إنشاء المواد والتسجيلات."
              title="لا توجد فصول دراسية بعد"
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>الفصل الدراسي</TH>
                  <TH>الفترة</TH>
                  <TH>المواد</TH>
                  <TH>التسجيلات</TH>
                  <TH>الحالة</TH>
                  <TH className="text-end">الإجراءات</TH>
                </TR>
              </THead>
              <TBody>
                {terms.data.map((term, index) => {
                  const edit = editData[index];

                  return (
                    <TR key={term.id}>
                      <TD className="font-semibold text-[var(--app-text)]">
                        <div className="flex items-center gap-2">
                          {term.name}
                          {edit && <TermFormDialog mode="edit" term={edit} />}
                        </div>
                      </TD>
                      <TD>
                        {formatDate(term.startDate)} ← {formatDate(term.endDate)}
                      </TD>
                      <TD>{formatNumber(term.subjectsCount)}</TD>
                      <TD>{formatNumber(term.enrollmentsCount)}</TD>
                      <TD>
                        {term.isCurrent ? (
                          <Badge tone="success">الفصل الحالي</Badge>
                        ) : (
                          <Badge tone="neutral">غير نشط</Badge>
                        )}
                      </TD>
                      <TD>
                        <div className="flex items-center justify-end gap-1.5">
                          <TermRowActions
                            canDelete={canManage}
                            isCurrent={term.isCurrent}
                            name={term.name}
                            termId={term.id}
                          />
                        </div>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound aria-hidden className="size-5" />
            تأمين الحساب
          </CardTitle>
          <CardDescription>تغيير كلمة مرور حسابك الحالي. استخدم 8 أحرف على الأقل.</CardDescription>
        </CardHeader>
        <CardContent>
          {canManage ? (
            <PasswordForm />
          ) : (
            <EmptyState
              description="لا تملك صلاحية تعديل إعدادات النظام."
              title="صلاحية غير متاحة"
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings2 aria-hidden className="size-5" />
            صلاحيات مدير النظام
          </CardTitle>
          <CardDescription>ملخص ما يمكن للمدير تنفيذه داخل النظام.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {[
            "إدارة الطلاب",
            "إدارة المواد",
            "تسجيل الحضور",
            "إنشاء الامتحانات",
            "إدارة بنك الأسئلة",
            "نشر الإعلانات",
            "إدارة الفصول الدراسية",
          ].map((label) => (
            <Badge key={label} tone="brand">
              {label}
            </Badge>
          ))}
        </CardContent>
      </Card>
    </AppShell>
  );
}
