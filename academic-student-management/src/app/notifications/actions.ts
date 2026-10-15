"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { authOptions } from "@/auth";
import { markAllNotificationsRead, markNotificationRead } from "@/lib/notifications";

async function requireUserId() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/sign-in");
  return session.user.id;
}

export async function markReadAction(_prevState: { status: string; message?: string }, formData: FormData) {
  const userId = await requireUserId();
  const notificationId = String(formData.get("notificationId") ?? "");
  if (!notificationId) return { status: "error", message: "معرف الإشعار مفقود." };

  await markNotificationRead(userId, notificationId);
  revalidatePath("/notifications");
  return { status: "success", message: "تم تعليم الإشعار كمقروء." };
}

export async function markAllReadAction(_prevState: { status: string; message?: string }, formData: FormData) {
  void formData;
  const userId = await requireUserId();
  const count = await markAllNotificationsRead(userId);
  revalidatePath("/notifications");
  return { status: "success", message: `تم تعليم ${count} إشعار كمقروء.` };
}
