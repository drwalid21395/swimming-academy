import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1 text-xs font-bold ring-1 ring-inset",
  {
    variants: {
      tone: {
        neutral: "bg-slate-500/10 text-slate-700 ring-slate-500/20 dark:text-slate-200",
        brand: "bg-brand-500/12 text-brand-700 ring-brand-500/25 dark:text-brand-200",
        blue: "bg-sky-500/12 text-sky-700 ring-sky-500/25 dark:text-sky-200",
        info: "bg-indigo-500/12 text-indigo-700 ring-indigo-500/25 dark:text-indigo-200",
        success: "bg-emerald-500/12 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300",
        warning: "bg-amber-500/15 text-amber-700 ring-amber-500/25 dark:text-amber-300",
        danger: "bg-rose-500/12 text-rose-700 ring-rose-500/25 dark:text-rose-300",
        violet: "bg-violet-500/12 text-violet-700 ring-violet-500/25 dark:text-violet-200",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>["tone"]>;

export function Badge({
  className,
  tone,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
