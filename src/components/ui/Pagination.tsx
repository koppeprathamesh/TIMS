import { Button } from "@/components/ui/Button";
import { pluralize } from "@/lib/labels";

export function Pagination({
  page,
  totalPages,
  total,
  noun,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  noun: string;
  onPageChange: (page: number) => void;
}) {
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm">
      <span className="text-[var(--color-text-muted)]" aria-live="polite">
        Page {page} of {totalPages} · {pluralize(total, noun)}
      </span>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPageChange(Math.max(1, page - 1))}>
          Previous
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
