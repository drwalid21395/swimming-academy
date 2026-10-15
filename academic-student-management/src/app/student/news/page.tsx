import { Megaphone, Newspaper, Pin } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/primitives";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState, QueryErrorState } from "@/components/ui/states";
import { databaseErrorMessage } from "@/lib/dashboard-data";
import { formatDateTime, formatNumber } from "@/lib/format";
import { getStudentProfile } from "@/lib/student-auth";
import { listStudentNews } from "@/lib/student-portal";

import { StudentShell } from "../shell";

export default async function StudentNewsPage() {
  const profile = await getStudentProfile();

  const items = await listStudentNews(profile.id).catch((error) => {
    console.error("[student-news]", error);
    return null;
  });

  return (
    <StudentShell
      subtitle="آخر الإعلانات المنشورة في موادك المسجلة"
      title="الأخبار"
      userName={profile.fullName}
    >
      {items === null ? (
        <QueryErrorState message={databaseErrorMessage} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard
              hint="إعلان في موادك"
              icon={Newspaper}
              label="إجمالي الإعلانات"
              tone="blue"
              value={formatNumber(items.length)}
            />
            <StatCard
              hint="أحدث إعلان في موادك"
              icon={Megaphone}
              label="آخر تحديث"
              tone="emerald"
              value={items[0]?.publishedAt ? formatDateTime(items[0].publishedAt) : "—"}
            />
            <StatCard
              hint="إعلانات مهمة مثبتة"
              icon={Pin}
              label="إعلانات مثبتة"
              tone="amber"
              value={formatNumber(items.filter((item) => item.isPinned).length)}
            />
          </div>

          <div>
            <PageHeader
              description={`${formatNumber(items.length)} إعلان منشور في موادك`}
              title="آخر الإعلانات"
            />

            <div className="space-y-3">
              {items.length === 0 ? (
                <Card>
                  <CardContent>
                    <EmptyState
                      description="لا توجد إعلانات منشورة في موادك حالياً."
                      title="لا توجد أخبار"
                    />
                  </CardContent>
                </Card>
              ) : (
                items.map((item) => (
                  <Card key={item.id}>
                    <CardContent className="space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        {item.isPinned && (
                          <Badge tone="warning">
                            <Pin aria-hidden className="size-3" />
                            مثبت
                          </Badge>
                        )}
                        <h3 className="text-base font-bold text-slate-900 dark:text-slate-50">
                          {item.title}
                        </h3>
                      </div>

                      <p className="whitespace-pre-line text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                        {item.content}
                      </p>

                      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                        <span className="font-semibold text-slate-600 dark:text-slate-300">
                          {item.subjectName} ({item.subjectCode})
                        </span>
                        <span>بواسطة {item.authorName}</span>
                        <span>{item.publishedAt ? formatDateTime(item.publishedAt) : ""}</span>
                      </p>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </StudentShell>
  );
}
