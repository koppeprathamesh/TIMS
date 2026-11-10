import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 text-center">
      <h1 className="page-heading text-3xl font-semibold">Page not found</h1>
      <p className="text-sm text-[var(--color-text-muted)]">
        The page you are looking for does not exist or has moved.
      </p>
      <Link href="/" className="btn-primary px-4 py-2 text-sm font-medium">
        Go to dashboard
      </Link>
    </div>
  );
}
