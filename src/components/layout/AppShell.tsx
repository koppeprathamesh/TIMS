"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { apiClient } from "@/lib/apiClient";
import { ROLE_LABELS, useAccess } from "@/lib/usePermissions";
import { workspaceDestination } from "@/lib/navigation";
import { Logo } from "@/components/ui/Logo";
import { Button } from "@/components/ui/Button";
import { Emoji } from "@/components/ui/Emoji";

interface NavItem {
  href: string;
  label: string;
  icon?: string;
  permission?: string;
  /** Needs a complete workspace (facility, department and project). */
  needsWorkspace?: boolean;
  superAdminOnly?: boolean;
}

// Primary tabs for day-to-day work.
const MAIN_TABS: NavItem[] = [
  { href: "/app/workspace", label: "Home", icon: "🏠", needsWorkspace: true },
  { href: "/app/dashboard", label: "Dashboard", icon: "📊", permission: "inventory.summary.read", needsWorkspace: true },
  { href: "/app/inventory/movements", label: "Movements", icon: "🔄", permission: "movement.read", needsWorkspace: true },
  { href: "/app/notifications", label: "Notifications", icon: "🔔" },
];

// Administration links live in the profile menu, gated by permission.
const MENU_LINKS: NavItem[] = [
  { href: "/app/users", label: "Users", icon: "👥", permission: "user.read" },
  { href: "/app/settings", label: "Settings", icon: "⚙️", permission: "settings.read" },
];

function isActive(pathname: string, href: string) {
  if (href === "/app/inventory/movements") return pathname.startsWith("/app/inventory");
  return pathname === href || pathname.startsWith(`${href}/`);
}

function Tab({ item, pathname, unread, onNavigate }: { item: NavItem; pathname: string; unread: number; onNavigate?: () => void }) {
  const active = isActive(pathname, item.href);
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm hover:no-underline max-md:border-b-0 max-md:border-l-2 ${
        active
          ? "border-[var(--color-primary)] bg-[var(--color-primary-soft)] font-semibold text-[var(--color-primary)]"
          : "border-transparent text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-primary)]"
      }`}
    >
      {item.icon && <Emoji className="mr-0.5">{item.icon}</Emoji>}
      {item.label}
      {item.href === "/app/notifications" && unread > 0 && (
        <span className="rounded-full bg-[var(--color-danger)] px-1.5 py-0.5 text-xs text-white" aria-label={`${unread} unread`}>
          {unread}
        </span>
      )}
    </Link>
  );
}

function ProfileMenu({
  displayName,
  email,
  roleLabel,
  links,
}: {
  displayName: string;
  email: string;
  roleLabel: string | null;
  links: { href: string; label: string; icon?: string }[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const items = () => Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
  const close = (restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) buttonRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    items()[0]?.focus();
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  function onKeyDown(e: React.KeyboardEvent) {
    const list = items();
    const index = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      e.preventDefault();
      close(true);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      else list[(index + 1) % list.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) setOpen(true);
      else list[(index - 1 + list.length) % list.length]?.focus();
    } else if (e.key === "Home" && open) {
      e.preventDefault();
      list[0]?.focus();
    } else if (e.key === "End" && open) {
      e.preventDefault();
      list[list.length - 1]?.focus();
    } else if (e.key === "Tab" && open) {
      setOpen(false);
    }
  }

  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");

  return (
    <div className="relative" ref={ref} onKeyDown={onKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${displayName}`}
        className="flex items-center gap-2 rounded-full border border-[var(--color-border)] py-1 pl-1 pr-3 text-sm hover:border-[var(--color-primary)] max-sm:pr-1"
      >
        <span aria-hidden="true" className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--color-primary)] text-xs font-semibold text-white">
          {initials || "?"}
        </span>
        <span className="hidden max-w-[10rem] truncate sm:inline">{displayName}</span>
        <span aria-hidden="true" className="text-[var(--color-text-muted)] max-sm:hidden">▾</span>
      </button>

      {open && (
        <div role="menu" aria-label="Account" className="card absolute right-0 z-30 mt-2 w-64 p-2 text-sm">
          <div className="border-b border-[var(--color-border)] px-3 pb-2 pt-1">
            <p className="truncate font-medium">{displayName}</p>
            <p className="truncate text-xs text-[var(--color-text-muted)]">{email}</p>
            {roleLabel && (
              <span className="mt-1 inline-block rounded-full bg-[var(--color-surface-muted)] px-2 py-0.5 text-xs">{roleLabel}</span>
            )}
          </div>
          <div className="py-1">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                role="menuitem"
                tabIndex={-1}
                onClick={() => setOpen(false)}
                className="block rounded-[var(--radius-control)] px-3 py-2 text-[var(--color-text)] hover:bg-[var(--color-surface-muted)] hover:no-underline"
              >
                {link.icon && <Emoji className="mr-2">{link.icon}</Emoji>}
                {link.label}
              </Link>
            ))}
            <Link
              href="/app/workspace"
              role="menuitem"
              tabIndex={-1}
              onClick={() => setOpen(false)}
              className="block rounded-[var(--radius-control)] px-3 py-2 text-[var(--color-text)] hover:bg-[var(--color-surface-muted)] hover:no-underline"
            >
              <Emoji className="mr-2">🔁</Emoji>
              Switch workspace
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const access = useAccess();
  const session = access?.session;
  const permissions = access?.permissions ?? null;
  const [unreadCount, setUnreadCount] = useState(0);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const ready = session?.workspaceStep === "ready";
  // The tabs belong to a chosen project; the selection screens (facility, department, project) stay clean.
  const showNav = ready && !/^\/app\/(workspace|projects)(\/|$)/.test(pathname);

  useEffect(() => {
    const refresh = () =>
      apiClient
        .get<{ unreadCount: number }>("/notifications?unread=true")
        .then((r) => setUnreadCount(r.unreadCount))
        .catch(() => {});
    refresh();
    window.addEventListener("tims:notifications-changed", refresh);
    return () => window.removeEventListener("tims:notifications-changed", refresh);
  }, []);

  async function handleLogout() {
    try {
      await apiClient.post("/auth/logout");
    } catch {
      setLogoutError("Unable to sign out. Please try again.");
      return;
    }
    // Full reload discards cached pages/permissions of the signed-out user.
    window.location.assign("/login");
  }

  const allowed = (item: NavItem) =>
    (!item.permission || permissions?.has(item.permission)) &&
    (!item.needsWorkspace || ready) &&
    (!item.superAdminOnly || access?.role === "SUPER_ADMIN");
  const mainTabs = MAIN_TABS.filter(allowed);
  const menuLinks = MENU_LINKS.filter(allowed);

  const tabs = (onNavigate?: () => void) =>
    mainTabs.map((item) => (
      <Tab key={item.href} item={item} pathname={pathname} unread={unreadCount} onNavigate={onNavigate} />
    ));

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-[var(--color-border)] bg-white">
        <div className="flex items-center gap-2 px-3 py-2 sm:gap-3 sm:px-4">
          {showNav && (
            <button
              type="button"
              className="rounded-[var(--radius-control)] border border-[var(--color-border)] px-2 py-1.5 md:hidden"
              aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
              aria-expanded={menuOpen}
              aria-controls="mobile-navigation"
              onClick={() => setMenuOpen((v) => !v)}
            >
              <span aria-hidden="true" className="block text-lg leading-none">{menuOpen ? "✕" : "☰"}</span>
            </button>
          )}
          <Link href={session ? workspaceDestination(session) : "/app/workspace"} className="flex items-center gap-2 font-semibold text-[var(--color-text)] hover:no-underline" aria-label="TIMS home">
            <Logo className="h-8 w-8" />
            <span className="text-xl font-bold tracking-tight max-sm:hidden">TIMS</span>
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <ProfileMenu
              displayName={session?.user?.displayName ?? "Account"}
              email={session?.user?.email ?? ""}
              roleLabel={access ? ROLE_LABELS[access.role] : null}
              links={menuLinks}
            />
            <Button variant="secondary" size="sm" onClick={handleLogout}>
              🚪 Logout
            </Button>
          </div>
        </div>
        {showNav && (
          <nav aria-label="Primary" className="hidden border-t border-[var(--color-border)] px-3 md:block md:px-4">
            <div className="flex flex-wrap items-center">{tabs()}</div>
          </nav>
        )}
        {showNav && menuOpen && (
          <nav id="mobile-navigation" aria-label="Primary" className="border-t border-[var(--color-border)] px-2 py-2 md:hidden">
            <div className="flex flex-col">{tabs(() => setMenuOpen(false))}</div>
          </nav>
        )}
      </header>
      {logoutError && <p role="alert" className="px-4 pt-2 text-sm text-[var(--color-danger)]">{logoutError}</p>}
      <main className="flex-1 px-2 pb-8">{children}</main>
    </div>
  );
}
