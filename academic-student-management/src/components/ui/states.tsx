import { DatabaseZap, Inbox } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "./card";

export function QueryErrorState({ message }: { message: string }) {
  return (
    <Card className="border-rose-500/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-rose-700 dark:text-rose-300">
          <DatabaseZap aria-hidden className="size-5" />
          تعذر عرض البيانات
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm leading-7 text-slate-600 dark:text-slate-300">{message}</p>
      </CardContent>
    </Card>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-[var(--glass-border)] bg-[var(--glass-bg)] px-6 py-12 text-center backdrop-blur-xl">
      <span className="grid size-12 place-items-center rounded-2xl bg-brand-500/10 text-brand-600 dark:text-brand-300">
        <Inbox aria-hidden className="size-6" />
      </span>
      <div>
        <p className="font-bold text-[var(--app-text)]">{title}</p>
        <p className="mt-1 text-sm text-muted">{description}</p>
      </div>
      {action}
    </div>
  );
}
