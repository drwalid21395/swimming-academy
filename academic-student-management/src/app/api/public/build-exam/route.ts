import { NextRequest, NextResponse } from "next/server";

import { buildPublicExam } from "@/lib/public-portal";

export const dynamic = "force-dynamic";

const MAX_TOTAL = 50;

function toCount(value: string | null) {
  const parsed = parseInt(value ?? "0", 10);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(parsed, MAX_TOTAL)) : 0;
}

export async function GET(request: NextRequest) {
  const subjectId = request.nextUrl.searchParams.get("subjectId");
  if (!subjectId) {
    return NextResponse.json({ error: "subjectId مطلوب" }, { status: 400 });
  }

  const mode = request.nextUrl.searchParams.get("mode") === "types" ? "types" : "all";

  let questions;
  if (mode === "types") {
    const typeCounts = {
      MULTIPLE_CHOICE: toCount(request.nextUrl.searchParams.get("mcq")),
      TRUE_FALSE: toCount(request.nextUrl.searchParams.get("tf")),
      SHORT_ANSWER: toCount(request.nextUrl.searchParams.get("short")),
      ESSAY: toCount(request.nextUrl.searchParams.get("essay")),
    };
    if (Object.values(typeCounts).every((count) => count === 0)) {
      return NextResponse.json({ error: "اختر عدداً من نوع واحد على الأقل" }, { status: 400 });
    }
    questions = await buildPublicExam(subjectId, { typeCounts });
  } else {
    const total = toCount(request.nextUrl.searchParams.get("total")) || 10;
    questions = await buildPublicExam(subjectId, { allCount: total });
  }

  return NextResponse.json({ questions });
}