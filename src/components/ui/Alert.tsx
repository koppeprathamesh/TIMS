import type { ReactNode } from "react";

type Tone = "error" | "success" | "info";

const ICONS: Record<Tone, string> = { error: "⚠️", success: "✅", info: "ℹ️" };

const STYLES: Record<Tone, string> = {
  error: "border-[var(--color-danger)] bg-[#fdf0f1] text-[var(--color-danger)]",
  success: "border-[var(--color-success)] bg-[#eaf6f0] text-[var(--color-success)]",
  info: "border-[var(--color-info)] bg-[#edf3fa] text-[var(--color-info)]",
};

// Errors use role="alert" so screen readers announce them immediately; other tones use role="status".
export function Alert({ tone = "error", children, className = "" }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`flex items-start gap-2 rounded-[var(--radius-control)] border-l-4 px-3 py-2 text-sm ${STYLES[tone]} ${className}`.trim()}
    >
      <span aria-hidden="true">{ICONS[tone]}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
