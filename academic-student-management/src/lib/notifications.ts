import { prisma } from "@/lib/prisma";

export type NotificationInput = {
  title: string;
  content: string;
  link?: string | null;
};

export type NotificationListItem = {
  id: string;
  title: string;
  content: string;
  link: string | null;
  readAt: Date | null;
  createdAt: Date;
};

export async function notifyUsers(userIds: string[], input: NotificationInput) {
  const unique = Array.from(new Set(userIds.filter(Boolean)));
  if (unique.length === 0) return 0;

  try {
    const result = await prisma.notification.createMany({
      data: unique.map((userId) => ({
        userId,
        title: input.title,
        content: input.content,
        link: input.link ?? null,
      })),
    });
    return result.count;
  } catch {
    return 0;
  }
}

export async function notifyEnrolledStudents(subjectId: string, input: NotificationInput) {
  const enrollments = await prisma.enrollment.findMany({
    where: { subjectId, status: "ACTIVE" },
    select: { student: { select: { userId: true } } },
  });

  return notifyUsers(
    enrollments.map((enrollment) => enrollment.student.userId),
    input,
  );
}

export async function listNotifications(
  userId: string,
  options: { onlyUnread?: boolean; take?: number } = {},
) {
  return prisma.notification.findMany({
    where: { userId, ...(options.onlyUnread ? { readAt: null } : {}) },
    orderBy: { createdAt: "desc" },
    take: Math.min(100, Math.max(5, options.take ?? 40)),
    select: { id: true, title: true, content: true, link: true, readAt: true, createdAt: true },
  });
}

export async function countUnreadNotifications(userId: string) {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

export async function markNotificationRead(userId: string, notificationId: string) {
  const result = await prisma.notification.updateMany({
    where: { id: notificationId, userId, readAt: null },
    data: { readAt: new Date() },
  });

  return result.count > 0;
}

export async function markAllNotificationsRead(userId: string) {
  const result = await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });

  return result.count;
}

export async function getExamForNotification(examId: string) {
  return prisma.exam.findUnique({
    where: { id: examId },
    select: {
      id: true,
      title: true,
      startsAt: true,
      subjectId: true,
      subject: { select: { name: true } },
    },
  });
}
