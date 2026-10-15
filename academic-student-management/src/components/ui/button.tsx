import { cva, type VariantProps } from "class-variance-authority";
import Link from "next/link";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-2xl font-bold transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-55",
  {
    variants: {
      variant: {
        primary:
          "bg-gradient-to-l from-brand-600 to-brand-500 text-white shadow-[0_14px_30px_-16px_rgba(36,69,234,0.95)] hover:shadow-[0_18px_38px_-16px_rgba(36,69,234,1)] active:scale-[0.98]",
        secondary:
          "border border-[var(--glass-border)] bg-[var(--glass-bg-strong)] text-[var(--app-text)] backdrop-blur-xl hover:border-brand-400/50 hover:bg-white dark:hover:bg-slate-800/80",
        ghost: "text-[var(--app-muted)] hover:bg-brand-500/10 hover:text-brand-700 dark:hover:text-brand-200",
        danger:
          "bg-gradient-to-l from-rose-600 to-rose-500 text-white shadow-[0_14px_30px_-16px_rgba(225,29,72,0.9)] hover:brightness-110 active:scale-[0.98]",
        subtle:
          "bg-brand-500/12 text-brand-700 hover:bg-brand-500/20 dark:bg-brand-500/15 dark:text-brand-200",
        outline:
          "border border-brand-500/40 text-brand-700 hover:border-brand-500 hover:bg-brand-500/10 dark:text-brand-200",
      },
      size: {
        sm: "h-9 px-3.5 text-xs",
        md: "h-11 px-5 text-sm",
        lg: "h-12 px-6 text-sm",
        icon: "size-10",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

type ButtonVariantProps = VariantProps<typeof buttonVariants>;

export function buttonClasses(props: ButtonVariantProps) {
  return buttonVariants(props);
}

export function Button({ className, variant, size, ...props }: React.ComponentProps<"button"> & ButtonVariantProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export function ButtonLink({ className, variant, size, ...props }: React.ComponentProps<typeof Link> & ButtonVariantProps) {
  return <Link className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
