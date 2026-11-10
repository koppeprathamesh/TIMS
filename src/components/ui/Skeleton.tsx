export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`skeleton ${className}`.trim()} />;
}

export function TableSkeleton({ rows = 5, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div role="status" aria-label="Loading" className="space-y-2">
      <Skeleton className="h-9 w-full" />
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="flex gap-3">
          {Array.from({ length: columns }, (_, col) => (
            <Skeleton key={col} className="h-7 flex-1" />
          ))}
        </div>
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export function CardGridSkeleton({ count = 4, className = "" }: { count?: number; className?: string }) {
  return (
    <div role="status" aria-label="Loading" className={`grid gap-3 ${className}`.trim()}>
      {Array.from({ length: count }, (_, index) => (
        <Skeleton key={index} className="h-24" />
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}

// Placeholder for a whole page while its data loads.
export function PageSkeleton() {
  return (
    <div role="status" aria-label="Loading page" className="mx-auto max-w-6xl space-y-4 px-2 py-6">
      <Skeleton className="h-8 w-64" />
      <CardGridSkeleton count={6} className="grid-cols-2 sm:grid-cols-3 lg:grid-cols-6" />
      <Skeleton className="h-64 w-full" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
