import type { ReactNode } from "react";

// Shared empty-state block: a short message plus an optional action (e.g. "Add Department").
// The action is only rendered when the caller has already checked the relevant permission.
export default function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center gap-3 p-8 text-center">
      <h3 className="text-base font-semibold">{title}</h3>
      {message && <p className="max-w-md text-sm text-[var(--color-text-muted)]">{message}</p>}
      {action}
    </div>
  );
}
