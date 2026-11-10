import Link from "next/link";

export default function UnauthorizedPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 text-center">
      <h1 className="page-heading text-3xl font-semibold">Access denied</h1>
      <p className="text-sm text-[var(--color-text-muted)]">
        You do not have permission to view this page. Contact your administrator if you believe
        this is incorrect.
      </p>
      <Link href="/app/dashboard" className="btn-primary px-4 py-2 text-sm font-medium">
        Back to dashboard
      </Link>
    </div>
  );
}
