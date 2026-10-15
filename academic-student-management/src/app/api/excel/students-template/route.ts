import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import * as XLSX from "xlsx";

import { authOptions } from "@/auth";
import { listDepartments } from "@/lib/departments";
import { hasPermission } from "@/lib/permissions";
import { listSpecializations } from "@/lib/specializations";
import {
  addStudentTemplateDropdowns,
  buildStudentTemplateWorkbook,
} from "@/lib/student-template";
import type { AppRole } from "@/lib/authorization";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user || !hasPermission(session.user.role as AppRole, "students.view")) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  }

  const [departments, specializations] = await Promise.all([
    listDepartments(),
    listSpecializations(),
  ]);

  const workbook = buildStudentTemplateWorkbook(
    departments.map((department) => ({
      id: department.id,
      name: department.name,
      code: department.code,
    })),
    specializations.map((specialization) => ({
      departmentId: specialization.departmentId,
      name: specialization.name,
      code: specialization.code,
    })),
  );

  const data = XLSX.write(workbook, { type: "buffer", bookType: "xlsx", compression: true });
  const buffer = addStudentTemplateDropdowns(Buffer.isBuffer(data) ? data : Buffer.from(data));

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="students-template.xlsx"; filename*=UTF-8''students-template.xlsx`,
    },
  });
}
