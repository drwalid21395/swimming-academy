import {
  Activity,
  Clock,
  ScrollText,
  UserCheck,
  type LucideIcon,
} from "lucide-react";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { adminNavItems } from "@/components/admin-nav";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState, QueryErrorState } from "@/components/ui/states";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { authOptions } from "@/auth";
import type { AppRole } from "@/lib/authorization";
import { auditEntityLabel, auditLogCsv, listAuditLogs, normalizeAuditFilters } from "@/lib/audit-log";
import { formatDateTime, formatNumber } from "@/lib/format";
import { roleLabels } from "@/lib/labels";
import { hasPermission } from "@/lib/permissions";

import { CsvExportButton } from "../reports/csv-export-button";
import { AuditFilters } from "./audit-filters";
import { AuditPagination } from "./audit-pagination";

const roleTones = {
  ADMIN: "danger",
  PROFESSOR: "violet",
  STUDENT: "blue",
} as const;

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/sign-in");
  if (!hasPermission(session.user.role as AppRole, "audit.view")) redirect("/unauthorized");

  const params = await searchParams;
  const value = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : "");

  const filters = normalizeAuditFilters({
    action: value("action"),
    entity: value("entity"),
    userId: value("userId"),
    from: value("from"),
    to: value("to"),
    q: value("q"),
    page: value("page"),
    pageSize: value("pageSize"),
  });

  const result = await listAuditLogs(filters);

  if (!result.ok) {
    return (
      <AppShell
        navItems={adminNavItems}
        roleLabel={roleLabels.ADMIN}
        subtitle="تتبع كل عملية حساسة: من نفّذها ومتى ومن أي عنوان."
        title="سجل التدقيق"
        userName={session.user.name ?? "مدير النظام"}
      >
        <QueryErrorState message={result.message} />
      </AppShell>
    );
  }

  const { rows, total, page, pageCount, actions, entities, users, stats } = result.data;

  return (
    <AppShell
      navItems={adminNavItems}
      roleLabel={roleLabels.ADMIN}
      subtitle="تتبع كل عملية حساسة: من نفّذها ومتى ومن أي عنوان."
      title="سجل التدقيق"
      userName={session.user.name ?? "مدير النظام"}
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          hint="ضمن نطاق التصفية الحالي"
          icon={ScrollText}
          label="إجمالي العمليات"
          tone="blue"
          value={formatNumber(stats.total)}
        />
        <StatCard
          hint="ضمن نطاق التصفية الحالي"
          icon={Clock}
          label="آخر 24 ساعة"
          tone="emerald"
          value={formatNumber(stats.last24h)}
        />
        <StatCard
          hint="مستخدمون قاموا بعمليات مسجلة"
          icon={UserCheck}
          label="المستخدمون النشطون"
          tone="amber"
          value={formatNumber(stats.actors)}
        />
        <StatCard
          hint={stats.topAction ? `${formatNumber(stats.topActionCount)} عملية` : "لا توجد بيانات"}
          icon={Activity}
          label="الإجراء الأكثر تكراراً"
          tone="violet"
          value={stats.topAction ?? "-"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>تصفية السجل</CardTitle>
          <CardDescription>
            صفِّ حسب الإجراء أو المستخدم أو النوع أو الفترة الزمنية، أو ابحث نصياً.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AuditFilters actions={actions} entities={entities} initial={filters} users={users} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>العمليات</CardTitle>
            <CardDescription>
              {total === 0
                ? "لا توجد عمليات مطابقة للنطاق المحدد."
                : `إجمالي ${formatNumber(total)} عملية مسجلة.`}
            </CardDescription>
          </div>
          <CsvExportButton csv={auditLogCsv(rows)} fileName="audit-log.csv" />
        </CardHeader>

        <CardContent>
          {rows.length === 0 ? (
            <EmptyState
              description="جرّب توسيع الفترة الزمنية أو إزالة بعض عوامل التصفية."
              title="لا توجد سجلات"
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>التاريخ والوقت</TH>
                  <TH>المنفّذ</TH>
                  <TH>الإجراء</TH>
                  <TH>العنصر</TH>
                  <TH>التفاصيل</TH>
                  <TH>IP</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((row) => (
                  <TR key={row.id}>
                    <TD className="whitespace-nowrap text-xs">{formatDateTime(row.createdAt)}</TD>
                    <TD>
                      {row.user ? (
                        <div className="flex flex-col gap-1">
                          <span className="font-semibold text-[var(--app-text)]">
                            {row.user.fullName}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <Badge tone={roleTones[row.user.role as keyof typeof roleTones] ?? "neutral"}>
                              {roleLabels[row.user.role as AppRole] ?? row.user.role}
                            </Badge>
                            <span className="text-xs text-slate-500">{row.user.email}</span>
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-500">غير معروف (حساب محذوف)</span>
                      )}
                    </TD>
                    <TD>
                      <Badge tone={row.actionTone}>{row.actionLabel}</Badge>
                      <p className="mt-1 text-[11px] text-slate-400">{row.action}</p>
                    </TD>
                    <TD>
                      <p className="font-semibold text-[var(--app-text)]">
                        {auditEntityLabel(row.entity)}
                      </p>
                      {row.entityId && (
                        <p className="max-w-40 truncate text-[11px] text-slate-400" title={row.entityId}>
                          {row.entityId}
                        </p>
                      )}
                    </TD>
                    <TD>
                      {row.metadata ? (
                        <p
                          className="max-w-72 truncate font-mono text-[11px] text-slate-500"
                          title={row.metadata}
                        >
                          {row.metadata}
                        </p>
                      ) : (
                        <span className="text-xs text-slate-400">-</span>
                      )}
                    </TD>
                    <TD className="font-mono text-[11px] text-slate-500">{row.ipAddress ?? "-"}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}

          {total > 0 && (
            <AuditPagination
              filters={filters}
              page={page}
              pageCount={pageCount}
              pageSize={filters.pageSize}
              total={total}
            />
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
