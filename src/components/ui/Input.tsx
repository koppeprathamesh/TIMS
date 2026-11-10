"use client";

import {
  Children,
  cloneElement,
  forwardRef,
  isValidElement,
  useId,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

const CONTROL =
  "w-full rounded-[var(--radius-control)] border bg-white px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] disabled:bg-[var(--color-surface-muted)] disabled:opacity-70";

function controlClass(invalid: boolean | undefined, extra = "") {
  return `${CONTROL} ${invalid ? "border-[var(--color-danger)]" : "border-[var(--color-border)]"} ${extra}`.trim();
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function Input({ invalid, className = "", ...props }, ref) {
    return <input ref={ref} aria-invalid={invalid || undefined} className={controlClass(invalid, className)} {...props} />;
  }
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(
  function Select({ invalid, className = "", ...props }, ref) {
    return <select ref={ref} aria-invalid={invalid || undefined} className={controlClass(invalid, className)} {...props} />;
  }
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(
  function Textarea({ invalid, className = "", ...props }, ref) {
    return <textarea ref={ref} aria-invalid={invalid || undefined} className={controlClass(invalid, className)} {...props} />;
  }
);

// Label + control + inline error. The child control receives the id and the aria wiring, so the
// label, hint and error text are announced with the field.
export function Field({
  label,
  required,
  hint,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: ReactNode;
  error?: string | null;
  children: ReactElement<Record<string, unknown>>;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;
  const control = Children.only(children);

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
        {required && (
          <span aria-hidden="true" className="text-[var(--color-danger)]">
            {" "}
            *
          </span>
        )}
      </label>
      {isValidElement(control) &&
        cloneElement(control, {
          id,
          invalid: Boolean(error),
          "aria-describedby": describedBy,
          required: control.props.required ?? required,
        })}
      {hint && (
        <p id={hintId} className="text-xs text-[var(--color-text-muted)]">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs text-[var(--color-danger)]">
          {error}
        </p>
      )}
    </div>
  );
}
