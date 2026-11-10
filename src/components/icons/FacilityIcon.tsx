// Inline vector building/facility icon used as the card image fallback.
// Kept as a component (not an asset) so it inherits currentColor and needs no network fetch.
export default function FacilityIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      role="img"
      aria-hidden="true"
      focusable="false"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Main tower */}
      <path d="M14 56V22l14-8v42" />
      {/* Side wing */}
      <path d="M28 56V30l22-8v34" />
      {/* Ground line */}
      <path d="M8 56h48" />
      {/* Windows */}
      <path d="M20 28h3M20 36h3M20 44h3" />
      <path d="M36 34h3M36 42h3M36 50h3" />
      <path d="M44 32h3M44 40h3M44 48h3" />
    </svg>
  );
}
