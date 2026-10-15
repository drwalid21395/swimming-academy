import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "@/auth";
import { getAttendanceMatrixExport } from "@/lib/attendance-export";
import {
  buildAttendanceMatrixWorkbook,
  matrixFrozenRows,
  writeFrozenWorkbook,
  xlsxResponse,
} from "@/lib/attendance-export-workbook";
import type { AppRole } from "@/lib/authorization";
import { hasPermission } from "@/lib/permissions";
import { loadProfessorScope } from "@/lib/professor-auth";

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user || !hasPermission(session.user.role as AppRole, "attendance.view")) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  }

  const subjectId = new URL(request.url).searchParams.get("subjectId");
  if (!subjectId) {
    return NextResponse.json({ error: "معرّف المادة مطلوب." }, { status: 400 });
  }

  /**
   * Same rule as the single-lecture export: a professor may only read a subject
   * assigned to them, otherwise any `subjectId` in the query string would do.
   */
  const scope =
    session.user.role === "PROFESSOR"
      ? await loadProfessorScope(session.user.id)
      : null;

  if (session.user.role === "PROFESSOR" && !scope) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
  }

  const matrix = await getAttendanceMatrixExport(
    subjectId,
    scope ? { subjectIds: scope.subjectIds } : undefined,
  ).catch((error) => {
    console.error("[attendance-export-matrix]", error);
    return undefined;
  });

  if (matrix === undefined) {
    return NextResponse.json({ error: "تعذر تحميل بيانات المادة." }, { status: 500 });
  }

  if (!matrix) {
    return NextResponse.json({ error: "المادة غير موجودة." }, { status: 404 });
  }

  if (matrix.columns.length === 0) {
    return NextResponse.json(
      { error: "لا توجد محاضرات مسجلة لهذه المادة بعد." },
      { status: 404 },
    );
  }

  const buffer = writeFrozenWorkbook(
    buildAttendanceMatrixWorkbook(matrix),
    matrixFrozenRows(),
  );

  return xlsxResponse(buffer, `attendance-matrix-${matrix.subjectCode}.xlsx`);
}