import { cn } from "@/lib/utils";

const tones = {
  blue: "from-brand-500/20 to-brand-400/5 text-brand-700 dark:text-brand-200",
  emerald: "from-emerald-500/20 to-emerald-400/5 text-emerald-700 dark:text-emerald-300",
  amber: "from-amber-500/20 to-amber-400/5 text-amber-700 dark:text-amber-300",
  rose: "from-rose-500/20 to-rose-400/5 text-rose-700 dark:text-rose-300",
  violet: "from-violet-500/20 to-violet-400/5 text-violet-700 dark:text-violet-200",
} as const;

export type IconTone = keyof typeof tones;

export function IconBadge({
  children,
  tone = "blue",
  className,
}: {
  children: React.ReactNode;
  tone?: IconTone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "grid size-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br text-lg font-bold ring-1 ring-inset ring-white/40",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h2 className="text-lg font-extrabold tracking-tight text-[var(--app-text)] sm:text-xl">{title}</h2>
        <p className="mt-1 text-sm text-muted">{description}</p>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
