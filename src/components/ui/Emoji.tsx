// Decorative emoji: hidden from screen readers so the visible text stays the accessible name.
export function Emoji({ children, className = "" }: { children: string; className?: string }) {
  return (
    <span aria-hidden="true" className={`inline-block leading-none ${className}`.trim()}>
      {children}
    </span>
  );
}
