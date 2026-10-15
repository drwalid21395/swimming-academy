import { ArrowRight, CalendarDays, Library, Megaphone, Users } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/primitives";
import { attendanceTone, Progress } from "@/components/ui/progress";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/states";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { formatDate, formatDateTime, formatNumber, formatPercent } from "@/lib/format";
import { getProfessorProfile } from "@/lib/professor-auth";
import {
  getProfessorSubjectDetail,
  listProfessorSubjectStudents,
} from "@/lib/professor-portal";

import { ProfessorShell } from "../../shell";

export default async function ProfessorSubjectDetailPage({
  params,
}: {
  params: Promise<{ subjectId: string }>;
}) {
  const profile = await getProfessorProfile();
  if (!profile.can("SUBJECTS_MANAGE")) redirect("/unauthorized");
  const { subjectId } = await params;

  const subject = await getProfessorSubjectDetail(profile.subjectIds, profile.id, subjectId);

  if (!subject) notFound();

  const students = await listProfessorSubjectStudents(
    profile.subjectIds,
    subjectId,
    subject.attendanceLimit,
  ).catch(() => []);

  const limited = subject.attendanceLimit;
  const studentRows = students;
  const overallAttendance =
    subject.totalRecords === 0 ? null : (subject.presentCount / subject.totalRecords) * 100;

  return (
    <ProfessorShell
      grants={profile.grants}
      kind={profile.kind}
      subtitle={`${subject.name} (${subject.code}) — ${subject.termName}`}
      title="تفاصيل المادة"
      userName={profile.fullName}
    >
      <>
        <PageHeader
          actions={
            <>
              <ButtonLink href="/professor/attendance" size="sm" variant="secondary">
                <CalendarDays aria-hidden className="size-4" />
                محاضراتي
              </ButtonLink>
              <ButtonLink href="/professor/questions" size="sm" variant="secondary">
                <Library aria-hidden className="size-4" />
                بنك الأسئلة
              </ButtonLink>
              <ButtonLink href="/professor/announcements" size="sm" variant="secondary">
                <Megaphone aria-hidden className="size-4" />
                إعلاناتي
              </ButtonLink>
            </>
          }
          description={subject.description ?? "لا يوجد وصف لهذه المادة."}
          title={`${subject.name} (${subject.code})`}
        />

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            hint="طالب مسجل"
            icon={Users}
            label="طلاب المادة"
            tone="blue"
            value={formatNumber(subject.studentsCount)}
          />
          <StatCard
            hint="محاضرة مسجلة"
            icon={CalendarDays}
            label="المحاضرات"
            tone="violet"
            value={formatNumber(subject.sessionsCount)}
          />
          <StatCard
            hint="سؤال في بنك المادة"
            icon={Library}
            label="أسئلة البنك"
            tone="emerald"
            value={formatNumber(subject.questionsCount)}
          />
          <StatCard
            hint="نسبة الحضور العامة"
            icon={Megaphone}
            label="متوسط الحضور"
            tone={attendanceTone(overallAttendance, limited)}
            value={formatPercent(overallAttendance)}
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle>آخر المحاضرات</CardTitle>
            </CardHeader>
            {subject.recentSessions.length === 0 ? (
              <CardContent>
                <EmptyState
                  description="لم تسجّل محاضرات في هذه المادة بعد."
                  title="لا توجد محاضرات"
                />
              </CardContent>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>المحاضرة</TH>
                    <TH>التاريخ</TH>
                    <TH>التسجيل</TH>
                    <TH>الحاضرون</TH>
                    <TH>إجراءات</TH>
                  </TR>
                </THead>
                <TBody>
                  {subject.recentSessions.map((session) => (
                    <TR key={session.id}>
                      <TD>{session.title ?? "محاضرة بدون عنوان"}</TD>
                      <TD>{formatDate(session.date)}</TD>
                      <TD>
                        <Badge tone={session.markedCount >= session.studentsCount ? "success" : "warning"}>
                          {formatNumber(session.markedCount)} / {formatNumber(session.studentsCount)}
                        </Badge>
                      </TD>
                      <TD>{formatNumber(session.presentCount)}</TD>
                      <TD>
                        <div className="flex justify-end">
                          <ButtonLink
                            href={`/professor/attendance/${session.id}`}
                            size="sm"
                            variant="ghost"
                          >
                            فتح
                          </ButtonLink>
                        </div>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>

          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle>آخر الامتحانات</CardTitle>
            </CardHeader>
            {subject.recentExams.length === 0 ? (
              <CardContent>
                <EmptyState
                  description="لم يتم إنشاء امتحانات في هذه المادة بعد."
                  title="لا توجد امتحانات"
                />
              </CardContent>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>الامتحان</TH>
                    <TH>الموعد</TH>
                    <TH>المحاولات</TH>
                    <TH>بانتظار التصحيح</TH>
                    <TH>إجراءات</TH>
                  </TR>
                </THead>
                <TBody>
                  {subject.recentExams.map((exam) => (
                    <TR key={exam.id}>
                      <TD>
                        <Link
                          className="font-semibold text-slate-800 hover:text-brand-700 dark:text-slate-100"
                          href={`/professor/exams/${exam.id}`}
                        >
                          {exam.title}
                        </Link>
                        <p className="text-xs text-slate-500">
                          {exam.status === "PUBLISHED" ? "منشور" : "مسودة"}
                        </p>
                      </TD>
                      <TD>{formatDateTime(exam.startsAt)}</TD>
                      <TD>{formatNumber(exam.attemptsCount)}</TD>
                      <TD>
                        {exam.pendingCount > 0 ? (
                          <Badge tone="warning">{formatNumber(exam.pendingCount)}</Badge>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </TD>
                      <TD>
                        <div className="flex justify-end">
                          <ButtonLink
                            href={`/professor/exams/${exam.id}`}
                            size="sm"
                            variant="ghost"
                          >
                            فتح
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

        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>طلاب المادة</CardTitle>
          </CardHeader>
          {studentRows.length === 0 ? (
            <CardContent>
              <EmptyState
                description="لم يسجل أي طالب في هذه المادة بعد."
                title="لا يوجد طلاب"
              />
            </CardContent>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>الطالب</TH>
                  <TH>الرقم الجامعي</TH>
                  <TH>القسم</TH>
                  <TH>السنة</TH>
                  <TH>حاضر</TH>
                  <TH>غائب</TH>
                  <TH className="w-48">نسبة الحضور</TH>
                </TR>
              </THead>
              <TBody>
                {studentRows.map((student) => (
                  <TR key={student.studentId}>
                    <TD>{student.fullName}</TD>
                    <TD dir="ltr">{student.universityId}</TD>
                    <TD>{student.departmentName}</TD>
                    <TD>{formatNumber(student.academicYear)}</TD>
                    <TD>{formatNumber(student.presentCount)}</TD>
                    <TD>{formatNumber(student.absentCount)}</TD>
                    <TD>
                      <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
                        <span className="text-slate-500">
                          {formatNumber(student.recordsCount)} سجل
                        </span>
                        <span className="font-semibold text-slate-700 dark:text-slate-200">
                          {formatPercent(student.percentage)}
                        </span>
                      </div>
                      <Progress
                        size="sm"
                        tone={attendanceTone(student.percentage, limited)}
                        value={student.percentage}
                      />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}

          <CardContent>
            <p className="text-xs text-muted">
              حد الحضور المعتمد في المادة: {formatPercent(limited, 0)} — أي طالب أقل من هذا
              النسبة يظهر كمخالف.
            </p>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <ButtonLink href="/professor/subjects" size="sm" variant="ghost">
            <ArrowRight aria-hidden className="size-4" />
            رجوع إلى المواد
          </ButtonLink>
        </div>
      </>
    </ProfessorShell>
  );
}
