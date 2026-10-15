"use client";

import { Save } from "lucide-react";
import { useActionState } from "react";

import { updateSiteNameAction } from "./branding-actions";
import { BrandLogoPicker } from "@/components/brand-logo";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Spinner } from "@/components/ui/loading";

type BrandingActionResult = { status: "idle" | "success" | "error"; message?: string };

const initialState: BrandingActionResult = { status: "idle" };

export function BrandingForm({ siteName, siteLogo }: { siteName: string; siteLogo: string | null }) {
  const [state, nameAction, pending] = useActionState(updateSiteNameAction, initialState);

  return (
    <div className="space-y-6">
      <BrandLogoPicker siteLogo={siteLogo} />

      <form action={nameAction} className="space-y-4" noValidate>
        <Field
          error={state.status === "error" ? state.message : undefined}
          htmlFor="siteName"
          label="اسم المنصة"
          required
        >
          <Input defaultValue={siteName} id="siteName" maxLength={80} name="siteName" required />
        </Field>

        {state.status === "success" && state.message && (
          <p className="text-sm font-semibold text-emerald-700" role="status">
            {state.message}
          </p>
        )}

        <div className="flex justify-end">
          <Button disabled={pending} size="sm" type="submit">
            {pending ? <Spinner /> : <Save aria-hidden className="size-4" />}
            {pending ? "جارٍ الحفظ..." : "حفظ اسم المنصة"}
          </Button>
        </div>
      </form>

      <p className="text-xs text-muted">
        يظهر الاسم في كل الصفحات وفي تبويب المتصفح. الشعار يمكن تغييره أيضاً بالضغط على الأيقونة بجانب
        اسم المنصة في القائمة الجانبية.
      </p>
    </div>
  );
}