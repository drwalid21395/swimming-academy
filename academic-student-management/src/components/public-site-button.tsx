import { Globe } from "lucide-react";
import Link from "next/link";

export function PublicSiteButton() {
  return (
    <Link
      aria-label="الموقع العام"
      className="grid size-10 place-items-center rounded-xl border border-[var(--glass-border)] bg-[var(--field-bg)] text-slate-600 transition hover:bg-[var(--glass-bg-strong)] dark:text-slate-200"
      href="/public"
      rel="noopener noreferrer"
      target="_blank"
      title="الموقع العام"
    >
      <Globe aria-hidden className="size-5" />
    </Link>
  );
}