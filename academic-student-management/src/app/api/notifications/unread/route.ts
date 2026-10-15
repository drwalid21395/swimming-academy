import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "@/auth";
import { countUnreadNotifications } from "@/lib/notifications";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ count: 0 }, { status: 401 });

  const count = await countUnreadNotifications(session.user.id);
  return NextResponse.json({ count }, { headers: { "Cache-Control": "no-store" } });
}
