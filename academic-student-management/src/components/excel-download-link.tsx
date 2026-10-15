"use client";

import { Download } from "lucide-react";
import { useState } from "react";

/**
 * Plain anchor styled as a button.
 *
 * A real link is used rather than a fetch plus a blob so the browser owns the
 * download: a large matrix is generated server-side, and a client-side blob would
 * hold the whole workbook in memory before saving it.
 */
export function ExcelDownloadLink({
  href,
  label,
  title,
  className,
  size = "sm",
  variant = "secondary",
  icon = true,
}: {
  href: string;
  label: string;
  title?: string;
  className?: string;
  size?: "sm" | "md" | "lg";
  variant?: "primary" | "secondary" | "ghost" | "danger";
  icon?: boolean;
}) {
  const [busy, setBusy] = useState(false);

  return (
    <a
      className={linkClasses({ size, variant, className })}
      href={href}
       onClick={() => {
         setBusy(true);
         window.setTimeout(() => setBusy(false), 8000);
       }}
       rel="noreferrer"
       title={title ?? label}
     >
       {icon && <Download aria-hidden className="size-4" />}
       {label}
       {busy && <span className="text-[10px] opacity-70">…</span>}
     </a>
  );
}

// Mirrors the button variants so the link sits in the same row as the buttons
// without importing the button component, which renders a <button> element.
function linkClasses({
  size,
  variant,
  className,
}: {
  size: "sm" | "md" | "lg";
  variant: "primary" | "secondary" | "ghost" | "danger";
  className?: string;
}) {
  const sizes = {
    sm: "h-9 px-3 text-xs",
    md: "h-10 px-4 text-sm",
    lg: "h-11 px-6 text-sm",
  };

  const variants = {
    primary: "bg-brand-600 text-white hover:bg-brand-700",
    secondary:
      "border border-[var(--glass-border)] bg-[var(--glass-bg)] text-[var(--app-text)] hover:bg-[var(--glass-bg-strong)]",
    ghost: "text-[var(--app-text)] hover:bg-[var(--glass-bg)]",
    danger: "bg-rose-600 text-white hover:bg-rose-700",
  };

  return [
    "inline-flex shrink-0 items-center justify-center gap-2 rounded-xl font-bold transition",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500",
    sizes[size],
    variants[variant],
    className ?? "",
  ].join(" ");
}