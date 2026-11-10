"use client";

import { accessStore, useAccessState } from "@/lib/usePermissions";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { isProtectedRoute, navigationRedirect } from "@/lib/navigation";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";

export default function AccessBoundary({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { access, error, verifiedPath } = useAccessState();
  const needsCheck = isProtectedRoute(pathname) || pathname === "/login";
  // Once a session is cached, navigating renders immediately; the redirect policy runs against the
  // cached session while a background revalidation refreshes it.
  const checked = verifiedPath !== null;
  const destination = checked && !error ? navigationRedirect(pathname, access?.session ?? null) : null;

  useEffect(() => {
    if (needsCheck) void accessStore.load(pathname);
  }, [needsCheck, pathname]);

  useEffect(() => {
    // The root stays mounted while Next preserves pages with Activity. History and
    // BFCache restoration must invalidate even when a pathname has not changed.
    const recheck = () => {
      const path = window.location.pathname;
      if (isProtectedRoute(path) || path === "/login") void accessStore.load(path, true);
    };
    const onPageShow = (event: PageTransitionEvent) => { if (event.persisted) recheck(); };
    window.addEventListener("popstate", recheck);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("popstate", recheck);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  useEffect(() => {
    if (destination) router.replace(destination);
  }, [destination, router]);

  if (!needsCheck) return <>{children}</>;

  if (checked && error) {
    return (
      <div className="card mx-auto my-8 max-w-lg space-y-3 p-6">
        <h1 className="page-heading text-xl font-semibold">Unable to load your access</h1>
        <Alert>{error.message}</Alert>
        <p className="text-sm text-[var(--color-text-muted)]">
          Your permissions could not be verified. This does not mean your role has changed.
        </p>
        <Button onClick={() => void accessStore.load(pathname, true)}>Retry permissions</Button>
      </div>
    );
  }

  if (!checked || destination) return <PageSkeleton />;

  // Keyed by user and workspace: switching either remounts the page so it reloads its data and
  // never shows another identity's or workspace's state.
  const session = access?.session;
  const key = [session?.user.id ?? "anonymous", session?.facility?.id, session?.department?.id, session?.project?.id].join(":");
  return <div key={key} className="contents">{children}</div>;
}
