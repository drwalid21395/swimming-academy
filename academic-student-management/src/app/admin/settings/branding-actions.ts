"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/permissions";
import {
  MAX_LOGO_BYTES,
  siteLogoSchema,
  siteNameSchema,
  updateSiteBranding,
} from "@/lib/site-branding";

/** Turns an uploaded image part into a base64 data URL, or passes a data URL through. */
async function readLogoPart(entry: FormDataEntryValue | null): Promise<string | null> {
  if (typeof entry === "string") return entry;
  if (!entry) return null;
  if (entry.size > MAX_LOGO_BYTES) return null;
  const buffer = Buffer.from(await entry.arrayBuffer());
  return `data:${entry.type || "image/png"};base64,${buffer.toString("base64")}`;
}

function revalidateBrandingPaths() {
  revalidatePath("/admin/settings");
  revalidatePath("/");
  revalidatePath("/sign-in");
  revalidatePath("/public");
}

export async function updateSiteNameAction(
  _prevState: unknown,
  formData: FormData,
): Promise<{ status: "idle" | "success" | "error"; message?: string }> {
  const actor = await requirePermission("settings.manage");
  const rawName = String(formData.get("siteName") ?? "").trim();
  const parsed = siteNameSchema.safeParse(rawName);

  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "راجع اسم المنصة قبل الحفظ.",
    };
  }

  try {
    await updateSiteBranding(actor.id, { siteName: parsed.data });
    revalidateBrandingPaths();
    return { status: "success", message: "تم حفظ اسم المنصة." };
  } catch {
    return { status: "error", message: "تعذر حفظ اسم المنصة. حاول مرة أخرى لاحقاً." };
  }
}

export async function updateSiteLogoAction(
  _prevState: unknown,
  formData: FormData,
): Promise<{ status: "idle" | "success" | "error"; message?: string }> {
  const actor = await requirePermission("settings.manage");

  try {
    const clear = String(formData.get("clear") ?? "") === "1";
    if (clear) {
      await updateSiteBranding(actor.id, { siteLogo: null });
      revalidateBrandingPaths();
      return { status: "success", message: "تمت إزالة شعار المنصة." };
    }

    const logo = await readLogoPart(formData.get("siteLogo"));
    if (!logo) {
      return { status: "error", message: "اختر صورة شعار بحجم أقل من 500 كيلوبايت." };
    }
    const parsed = siteLogoSchema.safeParse(logo);
    if (!parsed.success) {
      return { status: "error", message: parsed.error.issues[0]?.message ?? "الشعار غير صالح." };
    }

    await updateSiteBranding(actor.id, { siteLogo: parsed.data });
    revalidateBrandingPaths();
    return { status: "success", message: "تم تحديث شعار المنصة." };
  } catch {
    return { status: "error", message: "تعذر تحديث شعار المنصة. حاول مرة أخرى لاحقاً." };
  }
}