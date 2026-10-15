import { cache } from "react";
import { z } from "zod";

import { prisma } from "@/lib/prisma";

export const DEFAULT_SITE_NAME = "منصة دكتور وليد عبد الرحمن المجانية";

/** Raw (pre-encoding) byte ceiling for an uploaded logo image. */
export const MAX_LOGO_BYTES = 500 * 1024;

export const siteNameSchema = z
  .string()
  .trim()
  .min(2, "اسم المنصة قصير جداً (حد أدنى حرفين).")
  .max(80, "اسم المنصة طويل جداً (حد أقصى 80 حرفاً).");

const MAX_LOGO_DATA_LENGTH = 600_000;

export const siteLogoSchema = z
  .string()
  .regex(/^data:image\/(png|jpeg|webp);base64,/, "الصورة المدعومة PNG أو JPG أو WEBP.")
  .max(MAX_LOGO_DATA_LENGTH, "حجم الشعار كبير جداً (الحد الأقصى 500 كيلوبايت).");

export type SiteBranding = {
  siteName: string;
  siteLogo: string | null;
};

export const getSiteBranding = cache(async (): Promise<SiteBranding> => {
  try {
    const row = await prisma.siteSetting.findUnique({ where: { id: 1 } });
    const siteName = row?.siteName?.trim() ? row.siteName.trim() : DEFAULT_SITE_NAME;
    return { siteName, siteLogo: row?.siteLogo ?? null };
  } catch {
    return { siteName: DEFAULT_SITE_NAME, siteLogo: null };
  }
});

/** Applies a name and/or logo update to the single branding row. */
export async function updateSiteBranding(
  actorId: string,
  patch: { siteName?: string; siteLogo?: string | null },
) {
  const existing = await prisma.siteSetting.findUnique({ where: { id: 1 } });

  const siteName = patch.siteName?.trim() ? patch.siteName.trim() : DEFAULT_SITE_NAME;
  const siteLogo = patch.siteLogo === undefined ? existing?.siteLogo ?? null : patch.siteLogo;

  return prisma.$transaction(async (tx) => {
    await tx.siteSetting.upsert({
      where: { id: 1 },
      create: { id: 1, siteName, siteLogo },
      update: { siteName, siteLogo },
    });

    const changes: Record<string, { from: string | null; to: string | null }> = {};
    if (patch.siteName !== undefined) {
      changes.siteName = { from: existing?.siteName ?? null, to: siteName };
    }
    if (patch.siteLogo !== undefined) {
      changes.siteLogo = { from: existing?.siteLogo ? "(logo)" : null, to: siteLogo ? "(logo)" : null };
    }

    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "branding.update",
        entity: "SiteSetting",
        entityId: "1",
        metadata: changes,
      },
    });
  });
}