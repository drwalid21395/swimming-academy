import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const progressVariants = cva(
  "h-2 w-full overflow-hidden rounded-full bg-slate-500/15 dark:bg-white/10",
  {
    variants: {
      size: {
        sm: "h-1.5",
        md: "h-2.5",
        lg: "h-3.5",
      },
    },
    defaultVariants: { size: "md" },
  },
);

const barTones = {
  blue: "bg-gradient-to-l from-brand-500 to-brand-400",
  emerald: "bg-gradient-to-l from-emerald-600 to-emerald-400",
  amber: "bg-gradient-to-l from-amber-500 to-amber-400",
  rose: "bg-gradient-to-l from-rose-600 to-rose-400",
} as const;

export type ProgressTone = keyof typeof barTones;

export function Progress({
  value,
  tone = "blue",
  size,
  className,
}: {
  value: number | null;
  tone?: ProgressTone;
  size?: VariantProps<typeof progressVariants>["size"];
  className?: string;
}) {
  const safeValue = Math.min(100, Math.max(0, value ?? 0));

  return (
    <div
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={safeValue}
      className={cn(progressVariants({ size }), className)}
      role="progressbar"
    >
      <div
        className={cn("h-full rounded-full transition-all duration-700", barTones[tone])}
        style={{ width: `${safeValue}%` }}
      />
    </div>
  );
}

export function attendanceTone(percentage: number | null, limit = 75): ProgressTone {
  if (percentage === null) return "blue";
  if (percentage < limit) return "rose";
  if (percentage < limit + 10) return "amber";
  return "emerald";
}
