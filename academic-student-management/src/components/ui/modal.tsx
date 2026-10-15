"use client";

import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

const sizeClasses = {
  sm: "max-w-md",
  md: "max-w-2xl",
  lg: "max-w-4xl",
  xl: "max-w-6xl",
} as const;

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: keyof typeof sizeClasses;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open || !mounted) return null;

  // Rendered into <body> on purpose: every panel in this app sets
  // `backdrop-filter`, which turns that element into the containing block for
  // `position: fixed` children. Mounted in place, a dialog inside a card gets
  // sized and clipped by the card instead of covering the page.
  return createPortal(
    <div
      aria-modal="true"
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-slate-950/55 p-4 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="dialog"
    >
      {/* Capped to the viewport with the body scrolling inside it, so a long
          form stays fully reachable and its title never scrolls out of view. */}
      <div
        className={cn(
          "glass-panel-strong animate-scale-in flex max-h-[calc(100dvh-2rem)] w-full flex-col rounded-3xl p-6 shadow-[0_40px_90px_-40px_rgba(8,12,32,0.7)]",
          sizeClasses[size],
        )}
      >
        <div className="mb-5 flex shrink-0 items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-extrabold tracking-tight">{title}</h2>
            {description && <p className="mt-1.5 text-sm text-muted">{description}</p>}
          </div>
          <button
            aria-label="إغلاق"
            className="rounded-xl p-1.5 text-slate-400 transition hover:bg-brand-500/10 hover:text-brand-600"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden className="size-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>

        {footer && (
          <div className="mt-6 flex shrink-0 flex-wrap justify-end gap-2">{footer}</div>
        )}
      </div>
    </div>,
    document.body,
  );
}
