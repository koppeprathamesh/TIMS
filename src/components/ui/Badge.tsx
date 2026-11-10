import type { ReactNode } from "react";

export type BadgeTone = "success" | "warning" | "danger" | "info" | "processing" | "neutral";

const TONES: Record<BadgeTone, string> = {
  success: "var(--color-success)",
  warning: "var(--color-warning)",
  danger: "var(--color-danger)",
  info: "var(--color-info)",
  processing: "var(--color-processing)",
  neutral: "var(--color-neutral)",
};

// Colour is never the only signal: every badge carries text and a dot.
export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  const color = TONES[tone];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ backgroundColor: `color-mix(in srgb, ${color} 12%, white)`, color }}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      {children}
    </span>
  );
}
