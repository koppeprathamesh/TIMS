// Product mark: a wrench-and-box glyph in the accent colour. Decorative; the name is always
// rendered as text next to it.
export function Logo({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="8" fill="var(--color-primary)" />
      <path
        d="M9 12.5 16 9l7 3.5v7L16 23l-7-3.5v-7Z"
        fill="none"
        stroke="#fff"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M9 12.5 16 16l7-3.5M16 16v7" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}
