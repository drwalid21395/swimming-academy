import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "@/auth";
import { hasPermission } from "@/lib/permissions";
import type { AppRole } from "@/lib/authorization";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user || !hasPermission(session.user.role as AppRole, "questions.view")) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  }

  const buffer = buildQuestionTemplateBuffer();
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="questions-template.xlsx"; filename*=UTF-8''questions-template.xlsx`,
    },
  });
}

import * as XLSX from "xlsx";

import { buildQuestionTemplateWorkbook } from "@/lib/question-import";

function buildQuestionTemplateBuffer() {
  const data = XLSX.write(buildQuestionTemplateWorkbook(), {
    type: "buffer",
    bookType: "xlsx",
    compression: true,
  });
  return Buffer.isBuffer(data) ? data : Buffer.from(data);
}