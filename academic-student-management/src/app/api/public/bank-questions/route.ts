import { NextRequest, NextResponse } from "next/server";

import { listPublicBankQuestions } from "@/lib/public-portal";

export const dynamic = "force-dynamic";

const allowedTypes = new Set(["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER", "ESSAY"]);

export async function GET(request: NextRequest) {
  const subjectId = request.nextUrl.searchParams.get("subjectId");
  if (!subjectId) {
    return NextResponse.json({ error: "subjectId مطلوب" }, { status: 400 });
  }

  const typeParam = request.nextUrl.searchParams.get("type");
  const type = typeParam && allowedTypes.has(typeParam) ? (typeParam as "MULTIPLE_CHOICE" | "TRUE_FALSE" | "SHORT_ANSWER" | "ESSAY") : undefined;

  const questions = await listPublicBankQuestions(subjectId, { type });
  return NextResponse.json({ questions });
}