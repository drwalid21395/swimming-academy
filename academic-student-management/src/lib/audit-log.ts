import { prisma } from "@/lib/prisma";
import { toCsv } from "@/lib/csv";
import type { BadgeTone } from "@/components/ui/badge";

export const AUDIT_PAGE_SIZES = [25, 50, 100] as const;

export type AuditLogFilters = {
  action: string;
  entity: string;
  userId: string;
  from: string;
  to: string;
  q: string;
  page: number;
  pageSize: number;
};

export type AuditLogRow = {
  id: string;
  action: string;
  actionLabel: string;
  actionTone: BadgeTone;
  entity: string;
  entityId: string | null;
  metadata: string | null;
  ipAddress: string | null;
  createdAt: Date;
  user: { id: string; fullName: string; email: string; role: string } | null;
};

export type AuditOption = { value: string; label: string };

export type AuditLogResult =
  | {
      ok: true;
      data: {
        rows: AuditLogRow[];
        total: number;
        page: number;
        pageCount: number;
        actions: AuditOption[];
        entities: AuditOption[];
        users: AuditOption[];
        stats: {
          total: number;
          last24h: number;
          actors: number;
          topAction: string | null;
          topActionCount: number;
        };
      };
    }
  | { ok: false; message: string };

const actionLabels: Record<string, string> = {
  "announcement.create": "إنشاء إعلان",
  "announcement.update": "تعديل إعلان",
  "announcement.delete": "حذف إعلان",
  "attendance.create": "تسجيل حضور",
  "attendance.update": "تعديل حضور",
  "attendance.delete": "حذف حضور",
  "auth.password.change": "تغيير كلمة المرور",
  "exam.create": "إنشاء امتحان",
  "exam.update": "تعديل امتحان",
  "exam.delete": "حذف امتحان",
  "exam.questions.update": "تحديث أسئلة امتحان",
  "exam.publish": "نشر امتحان",
  "exam.attempt.start": "بدء محاولة",
  "exam.attempt.submit": "تسليم محاولة",
  "exam.attempt.grade": "تصحيح محاولة",
  "question.create": "إضافة سؤال",
  "question.update": "تعديل سؤال",
  "question.delete": "حذف سؤال",
  "student.create": "إضافة طالب",
  "student.update": "تعديل طالب",
  "student.delete": "حذف طالب",
  "subject.create": "إضافة مادة",
  "subject.update": "تعديل مادة",
  "subject.delete": "حذف مادة",
  "term.create": "إضافة فصل دراسي",
  "term.update": "تعديل فصل دراسي",
  "term.delete": "حذف فصل دراسي",
  "term.activate": "تفعيل فصل دراسي",
  "professor.permission.grant": "منح صلاحية لدكتور",
  "professor.permission.revoke": "سحب صلاحية من دكتور",
  "professor.scope.update": "تعديل نطاق مواد دكتور",
};

const actionTones: Record<string, BadgeTone> = {
  create: "success",
  update: "info",
  delete: "danger",
  publish: "brand",
  grade: "violet",
  start: "blue",
  submit: "blue",
  change: "warning",
  activate: "warning",
  grant: "success",
  revoke: "danger",
};

const entityLabels: Record<string, string> = {
  Announcement: "إعلان",
  AttendanceSession: "سجل حضور",
  AcademicTerm: "فصل دراسي",
  Exam: "امتحان",
  ExamAttempt: "محاولة امتحان",
  Professor: "دكتور",
  ProfessorPermission: "صلاحية دكتور",
  Question: "سؤال",
  Student: "طالب",
  Subject: "مادة",
  User: "حساب",
  announcement: "إعلان",
  attendance: "سجل حضور",
  exam: "امتحان",
  professor: "دكتور",
  question: "سؤال",
  student: "طالب",
  subject: "مادة",
  term: "فصل دراسي",
  auth: "الحساب",
};

export function auditActionLabel(action: string) {
  return actionLabels[action] ?? action;
}

export function auditEntityLabel(entity: string) {
  return entityLabels[entity] ?? entity;
}

function auditActionTone(action: string): BadgeTone {
  const suffix = action.split(".").at(-1) ?? "";
  return actionTones[suffix] ?? "neutral";
}

function startOfDay(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function endOfDay(value: string) {
  return new Date(`${value}T23:59:59.999Z`);
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function normalizeAuditFilters(
  raw: Partial<Record<keyof AuditLogFilters, string | undefined>>,
): AuditLogFilters {
  const pageSizeRaw = Number(raw.pageSize);
  const pageSize = (AUDIT_PAGE_SIZES as readonly number[]).includes(pageSizeRaw) ? pageSizeRaw : 25;

  return {
    action: raw.action?.trim() ?? "",
    entity: raw.entity?.trim() ?? "",
    userId: raw.userId?.trim() ?? "",
    from: raw.from && isIsoDate(raw.from) ? raw.from : "",
    to: raw.to && isIsoDate(raw.to) ? raw.to : "",
    q: raw.q?.trim() ?? "",
    page: Math.max(1, Number(raw.page) || 1),
    pageSize,
  };
}

function buildWhere(filters: AuditLogFilters) {
  const where: Record<string, unknown> = {};

  if (filters.action) where.action = filters.action;
  if (filters.entity) where.entity = filters.entity;
  if (filters.userId) where.userId = filters.userId;

  if (filters.from || filters.to) {
    const range: { gte?: Date; lte?: Date } = {};
    if (filters.from) range.gte = startOfDay(filters.from);
    if (filters.to) range.lte = endOfDay(filters.to);
    where.createdAt = range;
  }

  if (filters.q) {
    const contains = { contains: filters.q, mode: "insensitive" };
    where.OR = [
      { action: contains },
      { entity: contains },
      { entityId: contains },
      { ipAddress: contains },
      { user: { is: { fullName: contains } } },
      { user: { is: { email: contains } } },
    ];
  }

  return where;
}

export async function listAuditLogs(filters: AuditLogFilters): Promise<AuditLogResult> {
  try {
    const where = buildWhere(filters);
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [total, rows, actionGroups, entityGroups, actors, topAction, last24h] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
        select: {
          id: true,
          action: true,
          entity: true,
          entityId: true,
          metadata: true,
          ipAddress: true,
          createdAt: true,
          user: { select: { id: true, fullName: true, email: true, role: true } },
        },
      }),
      prisma.auditLog.groupBy({ by: ["action"], _count: { _all: true } }),
      prisma.auditLog.groupBy({ by: ["entity"], _count: { _all: true } }),
      prisma.user.findMany({
        where: { auditLogs: { some: {} } },
        orderBy: { fullName: "asc" },
        select: { id: true, fullName: true, email: true },
      }),
      prisma.auditLog.groupBy({
        by: ["action"],
        where,
        _count: { _all: true },
        orderBy: { _count: { action: "desc" } },
        take: 1,
      }),
      prisma.auditLog.count({ where: { AND: [where, { createdAt: { gte: since } }] } }),
    ]);

    const pageCount = Math.max(1, Math.ceil(total / filters.pageSize));
    const page = Math.min(filters.page, pageCount);

    return {
      ok: true,
      data: {
        rows: rows.map((row) => ({
          id: row.id,
          action: row.action,
          actionLabel: auditActionLabel(row.action),
          actionTone: auditActionTone(row.action),
          entity: row.entity,
          entityId: row.entityId,
          metadata: row.metadata === null ? null : JSON.stringify(row.metadata),
          ipAddress: row.ipAddress,
          createdAt: row.createdAt,
          user: row.user
            ? { id: row.user.id, fullName: row.user.fullName, email: row.user.email, role: row.user.role }
            : null,
        })),
        total,
        page,
        pageCount,
        actions: actionGroups
          .map((group) => ({ value: group.action, label: auditActionLabel(group.action) }))
          .sort((a, b) => a.label.localeCompare(b.label, "ar")),
        entities: entityGroups
          .map((group) => ({ value: group.entity, label: auditEntityLabel(group.entity) }))
          .sort((a, b) => a.label.localeCompare(b.label, "ar")),
        users: actors.map((user) => ({ value: user.id, label: `${user.fullName} (${user.email})` })),
        stats: {
          total,
          last24h,
          actors: actors.length,
          topAction: topAction[0] ? auditActionLabel(topAction[0].action) : null,
          topActionCount: topAction[0]?._count._all ?? 0,
        },
      },
    };
  } catch {
    return { ok: false, message: "تعذّر تحميل سجل التدقيق. تأكد من الاتصال بقاعدة البيانات ثم أعد المحاولة." };
  }
}

export function auditLogCsv(rows: AuditLogRow[]) {
  return toCsv(
    ["التاريخ والوقت", "المستخدم", "البريد", "الدور", "الإجراء", "الكيان", "المعرف", "التفاصيل", "IP"],
    rows.map((row) => [
      row.createdAt.toISOString(),
      row.user?.fullName ?? "غير معروف",
      row.user?.email ?? "-",
      row.user?.role ?? "-",
      row.actionLabel,
      auditEntityLabel(row.entity),
      row.entityId ?? "-",
      row.metadata ?? "-",
      row.ipAddress ?? "-",
    ]),
  );
}
