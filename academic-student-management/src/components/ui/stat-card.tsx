import type { LucideIcon } from "lucide-react";

import { IconBadge, type IconTone } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "blue",
  className,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
  tone?: IconTone;
  className?: string;
}) {
  return (
    <section
      className={cn("glass-panel glass-hover animate-fade-up rounded-3xl p-5", className)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-muted">{label}</p>
          <p className="mt-2 text-2xl font-extrabold tracking-tight text-[var(--app-text)]">{value}</p>
          {hint && <p className="mt-1.5 text-xs text-muted/80">{hint}</p>}
        </div>
        <IconBadge tone={tone}>
          <Icon aria-hidden className="size-5" />
        </IconBadge>
      </div>
    </section>
  );
}
