"use client";

import { useEffect, useRef, type ReactNode } from "react";

// Native <dialog> shown centered over the page; children are mounted only while open so a form
// inside starts fresh (and reloads its data) every time it is opened.
export function Modal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="modal-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="m-auto max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-[var(--radius-card)] border border-[var(--color-border)] bg-white p-0 shadow-xl backdrop:bg-black/40"
    >
      {open && (
        <div className="space-y-3 p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 id="modal-title" className="text-lg font-semibold">{title}</h2>
            <button type="button" onClick={onClose} aria-label="Close" className="rounded px-2 py-1 text-xl leading-none hover:bg-[var(--color-surface-muted)]">
              ×
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
