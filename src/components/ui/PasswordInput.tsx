"use client";

import { useState, type InputHTMLAttributes } from "react";
import { Input } from "@/components/ui/Input";

// Password field with a show/hide toggle. Works inside <Field>, which injects id and aria wiring.
export function PasswordInput({
  invalid,
  autoComplete = "current-password",
  className = "",
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { invalid?: boolean }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        {...props}
        invalid={invalid}
        type={show ? "text" : "password"}
        autoComplete={autoComplete}
        className={`pr-16 ${className}`.trim()}
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        aria-pressed={show}
        aria-label={show ? "Hide password" : "Show password"}
        className="absolute inset-y-0 right-0 px-3 text-xs font-medium text-[var(--color-primary)]"
      >
        {show ? "Hide" : "Show"}
      </button>
    </div>
  );
}
