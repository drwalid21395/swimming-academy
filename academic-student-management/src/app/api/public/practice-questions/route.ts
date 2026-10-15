import { NextRequest, NextResponse } from "next/server";

import { getPublicPracticeQuestions } from "@/lib/public-portal";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const subjectId = request.nextUrl.searchParams.get("subjectId");
  if (!subjectId) {
    return NextResponse.json({ error: "subjectId مطلوب" }, { status: 400 });
  }

  const rawTake = parseInt(request.nextUrl.searchParams.get("take") ?? "10", 10);
  const take = Math.max(1, Math.min(Number.isFinite(rawTake) ? rawTake : 10, 10));

  const questions = await getPublicPracticeQuestions(subjectId, take);
  return NextResponse.json({ questions });
}