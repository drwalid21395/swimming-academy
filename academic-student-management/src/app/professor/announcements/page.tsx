import { Megaphone, Pin, Radio } from "lucide-react";
import { redirect } from "next/navigation";

import { AnnouncementFilters } from "@/app/admin/announcements/announcement-filters";
import { AnnouncementFormDialog } from "@/app/admin/announcements/announcement-form-dialog";
import { AnnouncementRowActions } from "@/app/admin/announcements/announcement-row-actions";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/primitives";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState, QueryErrorState } from "@/components/ui/states";
import {
  getAnnouncementSubjects,
  listAnnouncements,
  parseAnnouncementFilters,
  type AnnouncementFilters as Filters,
  type AnnouncementSearchParams,
} from "@/lib/announcements";
import { databaseErrorMessage } from "@/lib/dashboard-data";
import { formatDate, formatNumber } from "@/lib/format";
import { getProfessorProfile } from "@/lib/professor-auth";

import { ProfessorShell } from "../shell";

function pageHref(filters: Filters, page: number) {
  const params = new URLSearchParams();

  if (filters.query) params.set("query", filters.query);
  if (filters.subjectId) params.set("subjectId", filters.subjectId);
  if (page > 1) params.set("page", String(page));

  const search = params.toString();
  return search ? `/professor/announcements?${search}` : "/professor/announcements";
}

export default async function ProfessorAnnouncementsPage({
  searchParams,
}: {
  searchParams: Promise<AnnouncementSearchParams>;
}) {
  const profile = await getProfessorProfile();
  if (!profile.can("ANNOUNCEMENTS_PUBLISH")) redirect("/unauthorized");
  const scope = { subjectIds: profile.subjectIds };
  const filters = parseAnnouncementFilters(await searchParams);

  const [result, subjects] = await Promise.all([
    listAnnouncements(filters, scope).catch((error) => {
      console.error("[professor-announcements]", error);
      return null;
    }),
    getAnnouncementSubjects(scope).catch(() => []),
  ]);

  return (
    <ProfessorShell
      grants={profile.grants}
      kind={profile.kind}
      subtitle="نشر إعلانات موادك وتثبيت المهم منها للطلاب"
      title="المنشورات"
      userName={profile.fullName}
    >
      {!result ? (
        <QueryErrorState message={databaseErrorMessage} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <StatCard
              hint="إعلان في موادك"
              icon={Megaphone}
              label="إجمالي الإعلانات"
              tone="blue"
              value={formatNumber(result.totalAnnouncements)}
            />
            <StatCard
              hint="إعلان تم نشره فعلياً"
              icon={Radio}
              label="إعلانات منشورة"
              tone="emerald"
              value={formatNumber(result.publishedCount)}
            />
            <StatCard
              hint="تظهر في أعلى القائمة دائماً"
              icon={Pin}
              label="إعلانات مثبتة"
              tone="amber"
              value={formatNumber(result.pinnedCount)}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>تصفية وبحث</CardTitle>
            </CardHeader>
            <CardContent>
              <AnnouncementFilters
                initial={{
                  query: filters.query ?? "",
                  subjectId: filters.subjectId ?? "",
                }}
                subjects={subjects}
              />
            </CardContent>
          </Card>

          <div>
            <PageHeader
              actions={
                subjects.length > 0 ? (
                  <AnnouncementFormDialog mode="create" subjects={subjects} />
                ) : undefined
              }
              description={`${formatNumber(result.total)} إعلان مطابق للفلاتر الحالية`}
              title="قائمة المنشورات"
            />

            <div className="space-y-3">
              {result.rows.length === 0 ? (
                <Card>
                  <CardContent>
                    <EmptyState
                      description="انشر إعلاناً ليصل إلى جميع طلاب موادك مباشرة."
                      title="لا توجد إعلانات بعد"
                    />
                  </CardContent>
                </Card>
              ) : (
                result.rows.map((row) => (
                  <Card key={row.id} className="overflow-hidden">
                    <CardContent className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          {row.isPinned && (
                            <Badge tone="warning">
                              <Pin aria-hidden className="size-3" />
                              مثبت
                            </Badge>
                          )}
                          <h3 className="text-base font-bold text-slate-900 dark:text-slate-50">
                            {row.title}
                          </h3>
                        </div>

                        <p className="whitespace-pre-line text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                          {row.content}
                        </p>

                        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                          <span className="font-semibold text-slate-600 dark:text-slate-300">
                            {row.subjectName} ({row.subjectCode})
                          </span>
                          <span>بواسطة {row.authorName}</span>
                          <span>
                            نُشر {row.publishedAt ? formatDate(row.publishedAt) : "—"}
                          </span>
                        </p>
                      </div>

                      <div className="flex items-start gap-2">
                        <AnnouncementFormDialog
                          announcement={{
                            id: row.id,
                            subjectId: row.subjectId,
                            title: row.title,
                            content: row.content,
                            isPinned: row.isPinned,
                            publishedAt: row.publishedAt,
                          }}
                          mode="edit"
                          subjects={subjects}
                        />
                        <AnnouncementRowActions
                          announcementId={row.id}
                          canDelete={false}
                          canManage
                          isPinned={row.isPinned}
                          title={row.title}
                        />
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>

            {result.pageCount > 1 && (
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
                    className={
                      result.page >= result.pageCount ? "pointer-events-none opacity-50" : undefined
                    }
                    href={pageHref(filters, Math.min(result.pageCount, result.page + 1))}
                    size="sm"
                    variant="secondary"
                  >
                    التالي
                  </ButtonLink>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </ProfessorShell>
  );
}
