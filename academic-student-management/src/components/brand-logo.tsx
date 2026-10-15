"use client";

import { Camera, ImagePlus, Loader2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useRef, useState } from "react";

import { updateSiteLogoAction } from "@/app/admin/settings/branding-actions";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/loading";
import { MAX_LOGO_BYTES } from "@/lib/site-branding";

const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp"];

type LogoActionResult = { status: "idle" | "success" | "error"; message?: string };

const initialState: LogoActionResult = { status: "idle" };

export function logoFileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("تعذر قراءة ملف الصورة."));
    reader.readAsDataURL(file);
  });
}

function validateLogoFile(file: File): string | null {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    return "الصورة المدعومة PNG أو JPG أو WEBP.";
  }
  if (file.size > MAX_LOGO_BYTES) {
    return "حجم الصورة أكبر من 500 كيلوبايت مسموح به.";
  }
  return null;
}

function LogoTile({ src, className }: { src: string; className: string }) {
  // eslint-disable-next-line @next/next/no-img-element -- inline base64 branding logo
  return <img alt="" className={`rounded-2xl object-cover ${className}`} src={src} />;
}

export function BrandLogo({
  siteName,
  siteLogo,
  canEdit,
}: {
  siteName: string;
  siteLogo: string | null;
  canEdit?: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    const validation = validateLogoFile(file);
    if (validation) {
      setError(validation);
      return;
    }

    try {
      setPending(true);
      const dataUrl = await logoFileToDataUrl(file);
      const formData = new FormData();
      formData.set("siteLogo", dataUrl);
      const result = await updateSiteLogoAction(null, formData);
      if (result.status !== "success") {
        setError(result.message ?? "تعذر تحديث شعار المنصة.");
        return;
      }
      setError(null);
      router.refresh();
    } catch {
      setError("تعذر تحديث شعار المنصة.");
    } finally {
      setPending(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const tile = siteLogo ? (
    <LogoTile className="size-12 shadow-[0_12px_28px_-12px_rgba(100,141,255,0.9)]" src={siteLogo} />
  ) : (
    <span className="grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-brand-400 to-violet-soft text-xl font-extrabold text-white shadow-[0_12px_28px_-12px_rgba(100,141,255,0.9)]">
      ع
    </span>
  );

  if (!canEdit) return tile;

  return (
    <>
      <input
        accept={ACCEPTED_TYPES.join(",")}
        aria-label="اختيار صورة شعار المنصة"
        className="hidden"
        onChange={(event) => handleFile(event.target.files?.[0])}
        ref={inputRef}
        type="file"
      />
      <button
        aria-label="تغيير شعار المنصة"
        className="group relative block"
        onClick={() => inputRef.current?.click()}
        title={`تغيير شعار ${siteName}`}
        type="button"
      >
        <span className="absolute -left-1 top-6 grid size-5 place-items-center rounded-full bg-slate-900/80 text-white opacity-0 transition group-hover:opacity-100">
          {pending ? <Loader2 aria-hidden className="size-3 animate-spin" /> : <Camera aria-hidden className="size-3" />}
        </span>
        <span className="block rounded-2xl transition group-hover:opacity-80">{tile}</span>
      </button>
      {error && (
        <span className="absolute left-0 top-full z-10 mt-1 w-56 rounded-xl bg-rose-600 px-3 py-2 text-xs font-semibold text-white shadow-lg">
          {error}
        </span>
      )}
    </>
  );
}

export function BrandLogoPicker({ siteLogo }: { siteLogo: string | null }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState(updateSiteLogoAction, initialState);

  const shownLogo = preview ?? siteLogo;

  function handleFileChange(file: File | undefined) {
    if (!file) {
      setPreview(null);
      return;
    }
    const validation = validateLogoFile(file);
    if (validation) {
      setFileError(validation);
      setPreview(null);
      return;
    }
    setFileError(null);
    setPreview(URL.createObjectURL(file));
  }

  return (
    <form action={formAction} className="space-y-3" encType="multipart/form-data">
      <div className="flex flex-wrap items-center gap-4">
        {shownLogo ? (
          <LogoTile className="size-16 ring-1 ring-[var(--glass-border)]" src={shownLogo} />
        ) : (
          <span className="grid size-16 place-items-center rounded-2xl bg-gradient-to-br from-brand-400 to-violet-soft text-2xl font-extrabold text-white">
            ع
          </span>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <input
            accept={ACCEPTED_TYPES.join(",")}
            className="hidden"
            name="siteLogo"
            onChange={(event) => handleFileChange(event.target.files?.[0])}
            ref={inputRef}
            type="file"
          />
          <Button onClick={() => inputRef.current?.click()} type="button" variant="secondary">
            <ImagePlus aria-hidden className="size-4" />
            {siteLogo ? "اختيار صورة أخرى" : "رفع شعار"}
          </Button>
          {preview && (
            <Button disabled={pending} type="submit">
              {pending ? <Spinner /> : <ImagePlus aria-hidden className="size-4" />}
              {pending ? "جارٍ الحفظ..." : "حفظ الشعار"}
            </Button>
          )}
          {siteLogo && (
            <Button disabled={pending} name="clear" type="submit" value="1" variant="ghost">
              <Trash2 aria-hidden className="size-4" />
              إزالة الشعار
            </Button>
          )}
        </div>
      </div>

      {fileError && (
        <p className="text-sm font-semibold text-rose-700" role="alert">
          {fileError}
        </p>
      )}
      {state.status !== "idle" && state.message && (
        <p
          className={`text-sm font-semibold ${
            state.status === "success" ? "text-emerald-700" : "text-rose-700"
          }`}
          role="status"
        >
          {state.message}
        </p>
      )}
    </form>
  );
}