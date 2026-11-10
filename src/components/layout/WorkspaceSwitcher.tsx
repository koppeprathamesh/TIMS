"use client";

import { useEffect, useRef, useState } from "react";
import { useAccess } from "@/lib/usePermissions";
import WorkspacePicker from "@/components/layout/WorkspacePicker";

// The header pill doubles as the workspace switcher: a popover with the same cascading picker.
export default function WorkspaceSwitcher() {
  const session = useAccess()?.session;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!session) return null;
  const parts = [session.facility?.name, session.department?.name, session.project?.name].filter(Boolean);
  const label = parts.length ? parts.join(" › ") : "Choose workspace";

  return (
    <div className="relative min-w-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Workspace: ${label}. Change workspace`}
        className="flex max-w-[16rem] items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-1 text-xs text-[var(--color-text)] hover:border-[var(--color-primary)] sm:max-w-md"
      >
        <span className="truncate">{label}</span>
        <span aria-hidden="true" className="text-[var(--color-text-muted)]">▾</span>
      </button>
      {open && (
        <div role="dialog" aria-label="Switch workspace" className="card absolute left-0 z-30 mt-2 w-[min(22rem,90vw)] p-4">
          <p className="mb-3 text-sm font-semibold">Switch workspace</p>
          <WorkspacePicker submitLabel="Switch" onApplied={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
