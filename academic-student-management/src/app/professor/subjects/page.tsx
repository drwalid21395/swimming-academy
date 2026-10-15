import { BookOpen, CalendarDays, FileQuestion, Star, Users } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/primitives";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState, QueryErrorState } from "@/components/ui/states";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { databaseErrorMessage } from "@/lib/dashboard-data";
import { formatDate, formatNumber, formatPercent } from "@/lib/format";
import { getProfessorProfile } from "@/lib/professor-auth";
import { listProfessorSubjects } from "@/lib/professor-portal";

import { ProfessorShell } from "../shell";

export default async function ProfessorSubjectsPage() {
  const profile = await getProfessorProfile();
  if (!profile.can("SUBJECTS_MANAGE")) redirect("/unauthorized");

  const result = await listProfessorSubjects(profile.subjectIds, profile.id).catch((error) => {
    console.error("[professor-subjects]", error);
    return null;
  });

  return (
    <ProfessorShell
      grants={profile.grants}
      kind={profile.kind}
      subtitle="نظرة عامة على المواد المسندة إليك وإحصاءاتها"
      title="موادي"
      userName={profile.fullName}
    >
      {!result ? (
        <QueryErrorState message={databaseErrorMessage} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              hint="مادة مسندة إليك"
              icon={BookOpen}
              label="عدد المواد"
              tone="blue"
              value={formatNumber(result.totalSubjects)}
            />
            <StatCard
              hint="طالب مسجل في موادك"
              icon={Users}
              label="إجمالي الطلاب"
              tone="violet"
              value={formatNumber(result.totalStudents)}
            />
            <StatCard
              hint="محاضرة تم تسجيل حضورها"
              icon={CalendarDays}
              label="المحاضرات"
              tone="emerald"
              value={formatNumber(result.totalSessions)}
            />
            <StatCard
              hint="امتحان تم إنشاؤه في موادك"
              icon={FileQuestion}
              label="الامتحانات"
              tone="amber"
              value={formatNumber(result.totalExams)}
            />
          </div>

          <div>
            <PageHeader
              description={`${formatNumber(result.totalSubjects)} مادة في الفصل الحالي`}
              title="قائمة المواد"
            />

            <Card className="overflow-hidden">
              {result.rows.length === 0 ? (
                <CardContent>
                  <EmptyState
                    description="لم يتم إسناد أي مواد إلى حسابك بعد. راجع إدارة الكلية."
                    title="لا توجد مواد مسندة"
                  />
                </CardContent>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>المادة</TH>
                      <TH>القسم</TH>
                      <TH>الطلاب</TH>
                      <TH>المحاضرات</TH>
                      <TH>الامتحانات</TH>
                      <TH>حد الحضور</TH>
                      <TH>المحاضرة القادمة</TH>
                      <TH>إجراءات</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {result.rows.map((row) => (
                      <TR key={row.id}>
                        <TD>
                          <Link
                            className="font-semibold text-slate-800 hover:text-brand-700 dark:text-slate-100"
                            href={`/professor/subjects/${row.id}`}
                          >
                            {row.name}
                          </Link>
                          <p className="text-xs text-slate-500" dir="ltr">
                            {row.code}
                          </p>
                        </TD>
                        <TD>{row.departmentName}</TD>
                        <TD>{formatNumber(row.studentsCount)}</TD>
                        <TD>{formatNumber(row.sessionsCount)}</TD>
                        <TD>{formatNumber(row.examsCount)}</TD>
                        <TD>{formatPercent(row.attendanceLimit, 0)}</TD>
                        <TD>
                          {row.nextSessionDate ? (
                            formatDate(row.nextSessionDate)
                          ) : (
                            <span className="text-slate-400">لا توجد</span>
                          )}
                        </TD>
                        <TD>
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            {row.isPrimary && (
                              <Badge tone="warning">
                                <Star aria-hidden className="size-3" />
                                أستاذ رئيسي
                              </Badge>
                            )}
                            <ButtonLink
                              href={`/professor/subjects/${row.id}`}
                              size="sm"
                              variant="ghost"
                            >
                              التفاصيل
                            </ButtonLink>
                          </div>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </Card>
          </div>
        </>
      )}
    </ProfessorShell>
  );
}
