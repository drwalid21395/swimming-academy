import { Prisma } from "@prisma/client";
import { z } from "zod";

import { notifyEnrolledStudents } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";

export const announcementFormSchema = z.object({
  subjectId: z.string().min(1, "المادة مطلوبة."),
  title: z.string().trim().min(3, "العنوان مطلوب (3 أحرف على الأقل).").max(160, "العنوان طويل جداً."),
  content: z.string().trim().min(3, "المحتوى مطلوب (3 أحرف على الأقل).").max(4000, "المحتوى طويل جداً."),
  isPinned: z.coerce.boolean().default(false),
  publishAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "صيغة النشر يجب أن تكون YYYY-MM-DDTHH:mm.")
    .optional()
    .or(z.literal("")),
});

export type AnnouncementFormValues = z.infer<typeof announcementFormSchema>;

export type AnnouncementScope = { subjectIds?: string[] };

export type AnnouncementFilters = {
  query?: string;
  subjectId?: string;
  page?: number;
  pageSize?: number;
};

export type AnnouncementSearchParams = Record<string, string | string[] | undefined>;

function readParam(params: AnnouncementSearchParams, key: string) {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

export function parseAnnouncementFilters(params: AnnouncementSearchParams): AnnouncementFilters {
  const page = Number(readParam(params, "page"));

  return {
    query: readParam(params, "query")?.trim() || undefined,
    subjectId: readParam(params, "subjectId") || undefined,
    page: Number.isFinite(page) && page > 0 ? page : 1,
    pageSize: 10,
  };
}

export type AnnouncementListItem = {
  id: string;
  title: string;
  content: string;
  isPinned: boolean;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  authorName: string;
};

export type AnnouncementListResult = {
  rows: AnnouncementListItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  totalAnnouncements: number;
  publishedCount: number;
  pinnedCount: number;
};

function buildWhere(
  filters: AnnouncementFilters,
  scope?: AnnouncementScope,
): Prisma.AnnouncementWhereInput {
  const query = filters.query?.trim();

  return {
    ...(scope?.subjectIds ? { subjectId: { in: scope.subjectIds } } : {}),
    ...(filters.subjectId ? { subjectId: filters.subjectId } : {}),
    ...(query
      ? {
          OR: [
            { title: { contains: query, mode: "insensitive" as const } },
            { content: { contains: query, mode: "insensitive" as const } },
            { subject: { name: { contains: query, mode: "insensitive" as const } } },
            { subject: { code: { contains: query, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };
}

export async function listAnnouncements(
  filters: AnnouncementFilters,
  scope?: AnnouncementScope,
): Promise<AnnouncementListResult> {
  const pageSize = Math.min(50, Math.max(5, filters.pageSize ?? 10));
  const page = Math.max(1, filters.page ?? 1);
  const where = buildWhere(filters, scope);
  const scopeWhere: Prisma.AnnouncementWhereInput = scope?.subjectIds
    ? { subjectId: { in: scope.subjectIds } }
    : {};

  const [total, totalAnnouncements, publishedCount, pinnedCount, rows] = await Promise.all([
    prisma.announcement.count({ where }),
    prisma.announcement.count({ where: scopeWhere }),
    prisma.announcement.count({ where: { ...scopeWhere, publishedAt: { not: null } } }),
    prisma.announcement.count({ where: { ...scopeWhere, isPinned: true } }),
    prisma.announcement.findMany({
      where,
      orderBy: [{ isPinned: "desc" }, { publishedAt: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        title: true,
        content: true,
        isPinned: true,
        publishedAt: true,
        createdAt: true,
        updatedAt: true,
        subject: { select: { id: true, name: true, code: true } },
        author: { select: { fullName: true } },
      },
    }),
  ]);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pageCount);

  return {
    rows: rows.map((row) => ({
      id: row.id,
      title: row.title,
      content: row.content,
      isPinned: row.isPinned,
      publishedAt: row.publishedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      subjectId: row.subject.id,
      subjectName: row.subject.name,
      subjectCode: row.subject.code,
      authorName: row.author.fullName,
    })),
    total,
    page: safePage,
    pageSize,
    pageCount,
    totalAnnouncements,
    publishedCount,
    pinnedCount,
  };
}

export type AnnouncementSubjectOption = {
  id: string;
  name: string;
  code: string;
};

export async function getAnnouncementSubjects(scope?: AnnouncementScope) {
  const subjects = await prisma.subject.findMany({
    where: scope?.subjectIds ? { id: { in: scope.subjectIds } } : undefined,
    orderBy: { name: "asc" },
    select: { id: true, name: true, code: true },
  });

  return subjects satisfies AnnouncementSubjectOption[];
}

export type AnnouncementEditData = {
  id: string;
  subjectId: string;
  title: string;
  content: string;
  isPinned: boolean;
  publishedAt: Date | null;
};

export async function getAnnouncementForEdit(
  announcementId: string,
  scope?: AnnouncementScope,
): Promise<AnnouncementEditData | null> {
  const announcement = await prisma.announcement.findUnique({
    where: { id: announcementId },
    select: {
      id: true,
      subjectId: true,
      title: true,
      content: true,
      isPinned: true,
      publishedAt: true,
    },
  });

  if (!announcement) return null;
  if (scope?.subjectIds && !scope.subjectIds.includes(announcement.subjectId)) return null;

  return announcement;
}

function toPublishDate(value: string | undefined): Date {
  if (value && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

async function assertSubjectInScope(subjectId: string, scope?: AnnouncementScope) {
  if (scope?.subjectIds && !scope.subjectIds.includes(subjectId)) {
    throw new Error("لا تملك صلاحية نشر إعلانات في هذه المادة.");
  }

  const subject = await prisma.subject.findUnique({
    where: { id: subjectId },
    select: { id: true, name: true, code: true },
  });

  if (!subject) throw new Error("المادة غير موجودة.");
  return subject;
}

export async function createAnnouncement(
  input: AnnouncementFormValues,
  actorId: string,
  scope?: AnnouncementScope,
) {
  const subject = await assertSubjectInScope(input.subjectId, scope);

  const announcement = await prisma.$transaction(async (tx) => {
    const created = await tx.announcement.create({
      data: {
        subjectId: input.subjectId,
        authorId: actorId,
        title: input.title,
        content: input.content,
        isPinned: input.isPinned,
        publishedAt: input.publishAt ? toPublishDate(input.publishAt) : new Date(),
      },
      select: { id: true, title: true, publishedAt: true },
    });

    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "announcement.create",
        entity: "Announcement",
        entityId: created.id,
        metadata: { subject: subject.name, code: subject.code, title: created.title },
      },
    });

    return created;
  });

  if (announcement.publishedAt && announcement.publishedAt.getTime() <= Date.now()) {
    await notifyEnrolledStudents(input.subjectId, {
      title: `إعلان جديد في ${subject.name}`,
      content: `${input.title}\n${input.content.slice(0, 240)}`,
      link: "/student/news",
    });
  }

  return announcement;
}

export async function updateAnnouncement(
  announcementId: string,
  input: AnnouncementFormValues,
  actorId: string,
  scope?: AnnouncementScope,
) {
  const existing = await prisma.announcement.findUnique({
    where: { id: announcementId },
    select: { id: true, subjectId: true, publishedAt: true },
  });

  if (!existing) throw new Error("الإعلان غير موجود.");
  if (scope?.subjectIds && !scope.subjectIds.includes(existing.subjectId)) {
    throw new Error("لا تملك صلاحية تعديل إعلانات هذه المادة.");
  }

  const subject = await assertSubjectInScope(input.subjectId, scope);
  const publishedAt = existing.publishedAt ?? toPublishDate(input.publishAt);

  return prisma.$transaction(async (tx) => {
    const announcement = await tx.announcement.update({
      where: { id: announcementId },
      data: {
        subjectId: input.subjectId,
        title: input.title,
        content: input.content,
        isPinned: input.isPinned,
        publishedAt,
      },
      select: { id: true, title: true },
    });

    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "announcement.update",
        entity: "Announcement",
        entityId: announcement.id,
        metadata: { subject: subject.name, code: subject.code, title: announcement.title },
      },
    });

    return announcement;
  });
}

export async function deleteAnnouncement(
  announcementId: string,
  actorId: string,
  scope?: AnnouncementScope,
) {
  const existing = await prisma.announcement.findUnique({
    where: { id: announcementId },
    select: { id: true, title: true, subjectId: true, subject: { select: { name: true } } },
  });

  if (!existing) throw new Error("الإعلان غير موجود.");
  if (scope?.subjectIds && !scope.subjectIds.includes(existing.subjectId)) {
    throw new Error("لا تملك صلاحية حذف إعلانات هذه المادة.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "announcement.delete",
        entity: "Announcement",
        entityId: existing.id,
        metadata: { subject: existing.subject.name, title: existing.title },
      },
    });

    await tx.announcement.delete({ where: { id: announcementId } });
  });
}
