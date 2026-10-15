"use client";

import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { downloadCsv, toCsv } from "@/lib/csv";
import { formatNumber, formatPercent } from "@/lib/format";
import type { StudentListItem } from "@/lib/students";

const headers = [
  "الاسم",
  "الرقم الجامعي",
  "البريد الإلكتروني",
  "رقم الهاتف",
  "القسم",
  "التخصص",
  "الفرقة",
  "عدد المواد",
  "حضور",
  "غياب",
  "غياب بعذر",
  "نسبة الحضور",
  "متوسط الدرجات",
];

export function ExportStudentsButton({ rows }: { rows: StudentListItem[] }) {
  const handleExport = () => {
    const csv = toCsv(
      headers,
      rows.map((row) => [
        row.fullName,
        row.universityId,
        row.email,
        row.phone,
        row.departmentName,
        row.specializationName ?? "",
        `الفرقة ${formatNumber(row.academicYear)}`,
        formatNumber(row.subjectsCount),
        formatNumber(row.attendance.present),
        formatNumber(row.attendance.absent),
        formatNumber(row.attendance.excused),
        formatPercent(row.attendance.percentage).replace("٪", "%"),
        formatPercent(row.averageScore).replace("٪", "%"),
      ]),
    );

    downloadCsv(`students-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  };

  return (
    <Button
      disabled={rows.length === 0}
      onClick={handleExport}
      size="sm"
      type="button"
      variant="secondary"
    >
      <Download aria-hidden className="size-4" />
      تصدير CSV
    </Button>
  );
}
