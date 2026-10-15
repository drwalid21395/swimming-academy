import { PenLine } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PracticeBank } from "@/components/practice-bank";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { QueryErrorState } from "@/components/ui/states";
import { databaseErrorMessage } from "@/lib/dashboard-data";
import { getStudentProfile } from "@/lib/student-auth";
import { listStudentSubjects } from "@/lib/student-portal";

import { StudentShell } from "../../../shell";

export const metadata: Metadata = {
  title: "ممارسة على أسئلة المادة | لوحة الطالب",
  robots: { index: false, follow: false },
};

export default async function StudentSubjectPracticePage({
  params,
}: {
  params: Promise<{ subjectId: string }>;
}) {
  const { subjectId } = await params;
  const profile = await getStudentProfile();

  const result = await listStudentSubjects(profile.id).catch((error) => {
    console.error("[student-subjects]", error);
    return null;
  });

  const row = result?.rows.find((item) => item.id === subjectId);

  if (!result) {
    return (
      <StudentShell
        subtitle="موادك المسجلة"
        title="موادي"
        userName={profile.fullName}
      >
        <QueryErrorState message={databaseErrorMessage} />
      </StudentShell>
    );
  }

  if (!row) notFound();

  return (
    <StudentShell
      subtitle={`ممارسة على أسئلة ${row.name} بتغذية راجعة فورية دون حفظ النتائج`}
      title={row.name}
      userName={profile.fullName}
    >
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PenLine aria-hidden className="size-5" />
            ممارسة على أسئلة المادة
          </CardTitle>
          <CardDescription>
            أسئلة عشوائية من بنك المادة مع إظهار الصحيح/الخطأ والإجابة النموذجية.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PracticeBank subjectId={row.id} />
        </CardContent>
      </Card>
    </StudentShell>
  );
}