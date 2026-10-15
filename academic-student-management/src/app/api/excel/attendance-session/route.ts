import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "@/auth";
import { getSessionAttendanceExport } from "@/lib/attendance-export";
import {
  buildSessionAttendanceWorkbook,
  sessionFrozenRows,
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

  const sessionId = new URL(request.url).searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ error: "معرّف المحاضرة مطلوب." }, { status: 400 });
  }

  /**
   * A professor may only export lectures of the subjects assigned to them. Without
   * this, `attendance.view` alone would let any professor read a roster by passing
   * someone else's `sessionId` in the query string.
   */
  const scope =
    session.user.role === "PROFESSOR"
      ? await loadProfessorScope(session.user.id)
      : null;

  if (session.user.role === "PROFESSOR" && !scope) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
  }

  const exported = await getSessionAttendanceExport(
    sessionId,
    scope ? { subjectIds: scope.subjectIds } : undefined,
  ).catch((error) => {
    console.error("[attendance-export-session]", error);
    return undefined;
  });

  if (exported === undefined) {
    return NextResponse.json({ error: "تعذر تحميل بيانات المحاضرة." }, { status: 500 });
  }

  if (!exported) {
    return NextResponse.json({ error: "المحاضرة غير موجودة." }, { status: 404 });
  }

  const buffer = writeFrozenWorkbook(
    buildSessionAttendanceWorkbook(exported),
    sessionFrozenRows(),
  );
  const stamp = exported.date.toISOString().slice(0, 10);

  return xlsxResponse(buffer, `attendance-${exported.subjectCode}-${stamp}.xlsx`);
}