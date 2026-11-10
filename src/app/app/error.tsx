"use client";

import { useEffect } from "react";
import { Button, LinkButton } from "@/components/ui/Button";

// Route-level error boundary for the application area; keeps the shell and offers recovery.
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-lg px-2 py-16 text-center">
      <h1 className="page-heading text-2xl font-semibold">Something went wrong</h1>
      <p role="alert" className="mt-2 text-sm text-[var(--color-text-muted)]">
        This page hit an unexpected problem. Your data is safe. Try again, or go back to the dashboard.
        {error.digest ? ` (Reference: ${error.digest})` : ""}
      </p>
      <div className="mt-5 flex justify-center gap-3">
        <Button onClick={reset}>Try again</Button>
        <LinkButton href="/app/dashboard" variant="secondary">Dashboard</LinkButton>
      </div>
    </div>
  );
}
