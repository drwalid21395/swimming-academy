import { cn } from "@/lib/utils";

const baseField =
  "w-full rounded-2xl border border-[var(--glass-border)] bg-[var(--field-bg)] px-4 text-sm text-[var(--app-text)] backdrop-blur-xl transition placeholder:text-slate-400 focus:border-brand-500 focus:bg-[var(--glass-bg-strong)] focus:outline-none focus:ring-4 focus:ring-brand-500/15";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input className={cn(baseField, "h-11", className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea className={cn(baseField, "min-h-28 py-3.5 leading-7", className)} {...props} />;
}

export function Select({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        baseField,
        "h-11 cursor-pointer appearance-none bg-[image:url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%2364748b%22 stroke-width=%222%22 stroke-linecap=%22round%22><path d=%22M6 9l6 6 6-6%22/></svg>')] bg-[length:18px] bg-[position:left_0.9rem_center] bg-no-repeat pl-10",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export function Field({
  label,
  hint,
  error,
  required,
  htmlFor,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label className="text-sm font-bold text-[var(--app-text)]" htmlFor={htmlFor}>
        {label}
        {required && <span className="text-rose-500"> *</span>}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-muted">{hint}</p>}
      {error && (
        <p className="text-xs font-semibold text-rose-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
