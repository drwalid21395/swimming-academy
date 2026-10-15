import { Bell, BellOff } from "lucide-react";
import { getServerSession } from "next-auth";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { adminNavItems } from "@/components/admin-nav";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { authOptions } from "@/auth";
import { roleHome, type AppRole } from "@/lib/authorization";
import { formatDateTime } from "@/lib/format";
import { roleLabels } from "@/lib/labels";
import { listNotifications } from "@/lib/notifications";
import { professorNavItems } from "@/app/professor/shell";
import { studentNavItems } from "@/app/student/shell";

import { MarkAllReadButton } from "./mark-all-read-button";
import { MarkReadButton } from "./mark-read-button";

const navByRole = {
  ADMIN: adminNavItems,
  PROFESSOR: professorNavItems,
  STUDENT: studentNavItems,
} as const;

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/sign-in");

  const role = session.user.role as AppRole;
  const params = await searchParams;
  const onlyUnread = params.filter === "unread";
  const items = await listNotifications(session.user.id, { onlyUnread });
  const unread = items.filter((item) => item.readAt === null).length;

  return (
    <AppShell
      navItems={navByRole[role] ?? adminNavItems}
      roleLabel={roleLabels[role] ?? roleLabels.ADMIN}
      subtitle="تنبيهات الإعلانات والامتحانات والتصحيح."
      title="الإشعارات"
      userName={session.user.name ?? "مستخدم النظام"}
    >
      <Card>
        <CardHeader className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Bell aria-hidden className="size-5" />
              الإشعارات
            </CardTitle>
            <CardDescription>
              {onlyUnread
                ? `عرض غير المقروء فقط (${unread})`
                : items.length === 0
                  ? "لا توجد إشعارات حتى الآن."
                  : `إجمالي ${items.length} إشعار، منها ${unread} غير مقروء.`}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Link
              className="rounded-xl border border-[var(--glass-border)] px-4 py-2 text-sm font-semibold transition hover:bg-[var(--glass-bg-strong)]"
              href={onlyUnread ? "/notifications" : "/notifications?filter=unread"}
            >
              {onlyUnread ? "عرض الكل" : "غير المقروء فقط"}
            </Link>
            {unread > 0 && <MarkAllReadButton />}
          </div>
        </CardHeader>

        <CardContent>
          {items.length === 0 ? (
            <EmptyState
              description="سيصلك إشعار عند نشر إعلان أو امتحان جديد، وعند تصحيح امتحانك."
              title={onlyUnread ? "لا توجد إشعارات غير مقروءة" : "لا توجد إشعارات"}
            />
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {items.map((item) => (
                <li
                  className={`flex items-start gap-4 py-4 ${item.readAt === null ? "" : "opacity-70"}`}
                  key={item.id}
                >
                  <span
                    aria-hidden
                    className={`mt-1 grid size-9 shrink-0 place-items-center rounded-xl ${
                      item.readAt === null
                        ? "bg-brand-500/15 text-brand-600 dark:text-brand-300"
                        : "bg-slate-500/10 text-slate-500"
                    }`}
                  >
                    {item.readAt === null ? <Bell aria-hidden className="size-4" /> : <BellOff aria-hidden className="size-4" />}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-[var(--app-text)]">{item.title}</p>
                      {item.readAt === null && <Badge tone="brand">جديد</Badge>}
                    </div>
                    <p className="mt-1 whitespace-pre-line text-sm leading-7 text-slate-600 dark:text-slate-300">
                      {item.content}
                    </p>
                    <p className="mt-1.5 text-xs text-slate-400">{formatDateTime(item.createdAt)}</p>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    {item.link && (
                      <Link
                        className="rounded-xl border border-[var(--glass-border)] px-3 py-2 text-xs font-semibold transition hover:bg-[var(--glass-bg-strong)]"
                        href={item.link}
                      >
                        فتح
                      </Link>
                    )}
                    {item.readAt === null && <MarkReadButton notificationId={item.id} />}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-slate-500">
        يمكنك أيضاً العودة إلى{" "}
        <Link className="font-semibold text-brand-600 dark:text-brand-300" href={roleHome[role]}>
          الصفحة الرئيسية
        </Link>
        .
      </p>
    </AppShell>
  );
}
