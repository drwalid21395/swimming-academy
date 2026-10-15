import {
  BookOpen,
  Building2,
  CalendarClock,
  ClipboardList,
  FileQuestion,
  Library,
  Lock,
  Newspaper,
  PenLine,
  Pin,
  Timer,
  UserRound,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PublicShell } from "@/components/public-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/states";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDateTime, formatNumber, formatScore } from "@/lib/format";
import { getPublicSubjectDetail } from "@/lib/public-portal";

import { BankByType } from "@/components/bank-by-type";
import { ExamBuilder } from "@/components/exam-builder";

const subjectTabs = ["exams", "bank", "news"] as const;
type SubjectTabKey = (typeof subjectTabs)[number];

export const metadata: Metadata = {
  title: "مادة | البوابة العامة",
  robots: { index: false, follow: false },
};

export const revalidate = 120;

export default async function PublicSubjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab: tabParam } = await searchParams;
  const activeTab: SubjectTabKey = tabParam === "bank" ? "bank" : tabParam === "news" ? "news" : "exams";

  const detail = await getPublicSubjectDetail(id);

  if (!detail) notFound();

  const { subject, professors, exams, questionBank, announcements, stats } = detail;
  const primary = professors.find((item) => item.isPrimary) ?? professors[0] ?? null;
  const maxBucket = Math.max(1, ...questionBank.categories.map((item) => item.count));

  return (
    <PublicShell
      crumbs={[
        { label: subject.department.name, href: `/public/department/${subject.department.code}` },
        ...(primary
          ? [{ label: primary.professor.fullName, href: `/public/professor/${primary.professor.id}` }]
          : []),
        { label: subject.name },
      ]}
      icon={BookOpen}
      subtitle={`${subject.code} — ${subject.department.name} — ${subject.academicTerm.name}`}
      title={subject.name}
      aside={
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserRound aria-hidden className="size-5" />
                담당 المادة
              </CardTitle>
              <CardDescription>الدكاترة المرتبطون بهذه المادة.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {professors.length === 0 ? (
                <p className="text-sm text-muted">لم يتم إسناد دكتور لهذه المادة بعد.</p>
              ) : (
                professors.map(({ professor, isPrimary: isPrimary }) => (
                  <Link
                    className="flex items-center justify-between gap-2 rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3 transition hover:border-brand-500/40"
                    href={`/public/professor/${professor.id}`}
                    key={professor.id}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-[var(--app-text)]">
                        {professor.fullName}
                      </span>
                      <span className="block text-xs text-muted">{professor.employeeCode}</span>
                    </span>
                    {isPrimary && <Badge tone="success">رئيسي</Badge>}
                  </Link>
                ))
              )}

              <Link
                className="flex items-center gap-2 rounded-2xl border border-[var(--glass-border)] p-3 text-sm font-semibold transition hover:bg-[var(--glass-bg-strong)]"
                href={`/public/department/${subject.department.code}`}
              >
                <Building2 aria-hidden className="size-4 text-muted" />
                قسم {subject.department.name}
              </Link>
            </CardContent>
          </Card>

          {subject.description && (
            <Card>
              <CardHeader>
                <CardTitle>وصف المادة</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-8 text-muted">{subject.description}</p>
              </CardContent>
            </Card>
          )}
        </div>
      }
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          hint="امتحان منشور"
          icon={FileQuestion}
          label="الامتحانات المتاحة"
          tone="blue"
          value={formatNumber(stats.exams)}
        />
        <StatCard
          hint="سؤال في البنك"
          icon={Library}
          label="بنك الأسئلة"
          tone="violet"
          value={formatNumber(stats.questions)}
        />
        <StatCard
          hint="إعلان منشور"
          icon={Newspaper}
          label="الإعلانات"
          tone="amber"
          value={formatNumber(stats.announcements)}
        />
      </div>

      <SubjectTabs
        active={activeTab}
        totals={{
          exams: stats.exams,
          bank: questionBank.total,
          news: announcements.length,
        }}
      />

      {activeTab === "exams" && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileQuestion aria-hidden className="size-5" />
                الاختبارات المتاحة
              </CardTitle>
              <CardDescription>
                معلومات الامتحانات المنشورة فقط. تسليم الإجابات يتطلب تسجيل الدخول.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {exams.length === 0 ? (
                <EmptyState description="لا يوجد امتحان منشور لهذه المادة حالياً." title="لا توجد امتحانات" />
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>الامتحان</TH>
                      <TH>يبدأ</TH>
                      <TH>ينتهي</TH>
                      <TH>المدة</TH>
                      <TH>الدرجة</TH>
                      <TH>الأسئلة</TH>
                      <TH>الحالة</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {exams.map((exam) => (
                      <TR key={exam.id}>
                        <TD>
                          <p className="font-semibold text-[var(--app-text)]">{exam.title}</p>
                          {exam.description && (
                            <p className="mt-0.5 max-w-72 text-xs text-muted">{exam.description}</p>
                          )}
                        </TD>
                        <TD className="whitespace-nowrap text-xs">{formatDateTime(exam.startsAt)}</TD>
                        <TD className="whitespace-nowrap text-xs">{formatDateTime(exam.endsAt)}</TD>
                        <TD className="whitespace-nowrap text-xs">
                          <span className="flex items-center gap-1.5">
                            <Timer aria-hidden className="size-3.5 text-muted" />
                            {formatNumber(exam.durationMin)} دقيقة
                          </span>
                        </TD>
                        <TD>{formatScore(exam.totalScore, 0)}</TD>
                        <TD>{formatNumber(exam.questionsCount)}</TD>
                        <TD>
                          {exam.isOpen ? (
                            <Badge tone="success">مفتوح الآن</Badge>
                          ) : (
                            <Badge tone="neutral">
                              <CalendarClock aria-hidden className="size-3" />
                              مغلق
                            </Badge>
                          )}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}

              <p className="mt-4 flex items-center gap-1.5 text-xs text-muted">
                <Lock aria-hidden className="size-3.5" />
                تسليم إجابات الامتحانات يتطلب تسجيل الدخول. ادخل بحسابك من صفحة
                <Link className="font-semibold text-brand-600 dark:text-brand-300" href="/sign-in">
                  تسجيل الدخول
                </Link>
                .
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ClipboardList aria-hidden className="size-5" />
                إنشاء امتحان من بنك الأسئلة
              </CardTitle>
              <CardDescription>
                جهّز امتحاناً تجريبياً بتحديد نوع الأسئلة وعددها من كل نوع، أو عشوائياً من جميع الأنواع،
                وأجب عليه فوراً مع عرض الإجابة. بدون تسجيل دخول ودون حفظ النتائج.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ExamBuilder
                options={questionBank.byType}
                subjectId={subject.id}
                total={questionBank.total}
              />
            </CardContent>
          </Card>
        </>
      )}

      {activeTab === "bank" && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Library aria-hidden className="size-5" />
                بنك الأسئلة
              </CardTitle>
              <CardDescription>توزيع أسئلة المادة حسب النوع والمستوى والتصنيف.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {questionBank.total === 0 ? (
                <EmptyState description="لم تتم إضافة أسئلة لهذه المادة بعد." title="البنك فارغ" />
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <BucketGroup
                      emptyText="لا توجد أسئلة"
                      items={questionBank.byType.map((item) => ({ label: item.label, count: item.count }))}
                      title="حسب النوع"
                    />
                    <BucketGroup
                      emptyText="لا توجد أسئلة"
                      items={questionBank.byDifficulty.map((item) => ({
                        label: item.label,
                        count: item.count,
                      }))}
                      title="حسب المستوى"
                    />
                  </div>

                  <div>
                    <p className="mb-2.5 text-sm font-bold text-[var(--app-text)]">حسب التصنيف</p>
                    {questionBank.categories.length === 0 ? (
                      <p className="text-sm text-muted">لا توجد تصنيفات لهذه المادة.</p>
                    ) : (
                      <div className="space-y-3">
                        {questionBank.categories.map((category) => (
                          <div key={category.name}>
                            <div className="mb-1 flex items-center justify-between text-sm">
                              <span className="font-medium text-slate-700 dark:text-slate-200">
                                {category.name}
                              </span>
                              <span className="text-muted">{formatNumber(category.count)}</span>
                            </div>
                            <Progress tone="blue" value={(category.count / maxBucket) * 100} />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <PenLine aria-hidden className="size-5" />
                ممارسة حسب نوع السؤال
              </CardTitle>
              <CardDescription>
                اختر النوع لفتح جميع أسئلته، أو ابدأ بأسئلة عشوائية من جميع الأنواع.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <BankByType
                options={questionBank.byType}
                subjectId={subject.id}
                total={questionBank.total}
              />
            </CardContent>
          </Card>
        </>
      )}

      {activeTab === "news" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Newspaper aria-hidden className="size-5" />
              إعلانات المادة
            </CardTitle>
            <CardDescription>الإعلانات المنشورة لهذه المادة.</CardDescription>
          </CardHeader>
          <CardContent>
            {announcements.length === 0 ? (
              <EmptyState description="لا توجد إعلانات منشورة لهذه المادة." title="لا توجد إعلانات" />
            ) : (
              <ul className="space-y-3">
                {announcements.map((announcement) => (
                  <li
                    className="rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-4"
                    key={announcement.id}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="flex items-center gap-2 font-extrabold text-[var(--app-text)]">
                        {announcement.isPinned && (
                          <Pin aria-hidden className="size-4 text-brand-500" />
                        )}
                        {announcement.title}
                      </p>
                      <span className="text-xs text-muted">{formatDateTime(announcement.publishedAt)}</span>
                    </div>
                    <p className="mt-2 whitespace-pre-line text-sm leading-8 text-slate-600 dark:text-slate-300">
                      {announcement.content}
                    </p>
                    <p className="mt-2 text-xs text-muted">{announcement.authorName}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </PublicShell>
  );
}

function SubjectTabs({
  active,
  totals,
}: {
  active: SubjectTabKey;
  totals: Record<SubjectTabKey, number>;
}) {
  const items: { key: SubjectTabKey; label: string; icon: typeof FileQuestion; count: number }[] = [
    { key: "exams", label: "الامتحانات", icon: FileQuestion, count: totals.exams },
    { key: "bank", label: "بنك الأسئلة", icon: Library, count: totals.bank },
    { key: "news", label: "الإعلانات", icon: Newspaper, count: totals.news },
  ];

  return (
    <div className="grid gap-2 sm:grid-cols-3" role="tablist">
      {items.map((item) => {
        const isActive = active === item.key;
        return (
          <Link
            aria-selected={isActive}
            className={`flex items-center justify-between gap-2 rounded-2xl border px-4 py-3.5 font-bold transition ${
              isActive
                ? "border-brand-500 bg-brand-500/12 text-brand-700 dark:border-brand-400/60 dark:text-brand-200"
                : "border-[var(--glass-border)] bg-[var(--glass-bg)] text-muted hover:bg-[var(--glass-bg-strong)] hover:text-[var(--app-text)]"
            }`}
            href={`?tab=${item.key}`}
            key={item.key}
            role="tab"
          >
            <span className="flex items-center gap-2">
              <item.icon aria-hidden className="size-4" />
              {item.label}
            </span>
            <Badge tone={isActive ? "brand" : "neutral"}>{formatNumber(item.count)}</Badge>
          </Link>
        );
      })}
    </div>
  );
}

function BucketGroup({
  title,
  items,
  emptyText,
}: {
  title: string;
  items: { label: string; count: number }[];
  emptyText: string;
}) {
  return (
    <div>
      <p className="mb-2.5 text-sm font-bold text-[var(--app-text)]">{title}</p>
      {items.length === 0 ? (
        <p className="text-sm text-muted">{emptyText}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li
              className="flex items-center justify-between rounded-xl bg-[var(--glass-bg-strong)] px-3 py-2 text-sm"
              key={item.label}
            >
              <span className="font-medium text-slate-700 dark:text-slate-200">{item.label}</span>
              <Badge tone="blue">{formatNumber(item.count)}</Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}