"use client";

import { useAccess } from "@/lib/usePermissions";
import { Emoji } from "@/components/ui/Emoji";

type Level = "facility" | "department" | "project";

const LEVELS: { key: Level; icon: string; label: string }[] = [
  { key: "facility", icon: "🏭", label: "Plant" },
  { key: "department", icon: "🏢", label: "Project" },
  { key: "project", icon: "📁", label: "Part" },
];

// Shows where the user is working (facility › department › project) in a readable size.
// `levels` limits how deep the trail goes for pages that sit above the project level.
export default function ScopeBar({ levels = ["facility", "department", "project"] }: { levels?: Level[] }) {
  const session = useAccess()?.session;
  if (!session) return null;

  const items = LEVELS.filter((l) => levels.includes(l.key))
    .map((l) => ({ ...l, name: session[l.key]?.name }))
    .filter((l): l is typeof l & { name: string } => Boolean(l.name));
  if (items.length === 0) return null;

  return (
    <nav aria-label="Current workspace" className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-base">
      {items.map((item, index) => {
        const last = index === items.length - 1;
        return (
          <span key={item.key} className="flex items-center gap-2">
            {index > 0 && <span aria-hidden="true" className="text-[var(--color-text-muted)]">›</span>}
            <span
              title={`${item.label}: ${item.name}`}
              className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-3 py-1 font-medium ${
                last
                  ? "border-[var(--color-primary)] bg-[var(--color-primary-soft)] text-[var(--color-primary)]"
                  : "border-[var(--color-border)] bg-white text-[var(--color-text)]"
              }`}
            >
              <Emoji>{item.icon}</Emoji>
              <span className="sr-only">{item.label}: </span>
              <span className="break-words">{item.name}</span>
            </span>
          </span>
        );
      })}
    </nav>
  );
}
