import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { permissionsForRole, type RoleCode } from "@/lib/authz/permissions";
import type { Access } from "@/lib/usePermissions";
import AccessBoundary from "@/components/layout/AccessBoundary";
import AppShell from "@/components/layout/AppShell";
import FacilitiesPage from "@/app/app/facilities/page";
import FacilityDetailPage from "@/app/app/facilities/[facilityId]/page";
import LoginPage from "@/app/login/page";
import type { NavigationSession } from "@/lib/navigation";

const mocked = vi.hoisted(() => ({
  pathname: "/app/facilities",
  state: { access: null as Access | null, error: null as Error | null, verifiedPath: null as string | null },
}));

vi.mock("@/lib/usePermissions", () => ({
  useAccessState: () => mocked.state,
  useAccess: () => mocked.state.access,
  accessStore: { load: vi.fn(), refresh: vi.fn(), getSnapshot: () => mocked.state },
  ROLE_LABELS: { SUPER_ADMIN: "Super Admin", INVENTORY_ADMIN: "Inventory Admin", USER: "User" },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => mocked.pathname,
  useParams: () => ({ facilityId: "facility-1" }),
  useSearchParams: () => new URLSearchParams(),
}));

beforeEach(() => {
  mocked.pathname = "/app/facilities";
  mocked.state = { access: null, error: null, verifiedPath: null };
});

function signIn(role: RoleCode, overrides: Partial<NavigationSession> = {}) {
  const session: NavigationSession = {
    user: { id: "u1", displayName: "Alex Admin", email: "admin@test.local" },
    organization: { id: "o1", name: "Organization" },
    facility: { id: "f1", name: "Plant" },
    department: { id: "d1", name: "Tool Room" },
    project: { id: "p1", name: "Line 1" },
    workspaceStep: "ready",
    role, permissions: [...permissionsForRole(role)],
    ...overrides,
  };
  mocked.state = { access: { role, permissions: permissionsForRole(role), session }, error: null, verifiedPath: mocked.pathname };
}

function guardedShell() {
  return renderToStaticMarkup(createElement(AccessBoundary, null, createElement(AppShell, null, "Protected page")));
}

describe("permission-dependent UI", () => {
  it("shows skeletons rather than a partial application while access loads", () => {
    const html = guardedShell();
    expect(html).toContain('aria-label="Loading page"');
    expect(html).not.toContain("Loading your access");
    expect(html).not.toContain("Protected page");
    expect(html).not.toContain("Access denied");
  });

  it("shows permission failures with a retry, not a false access denial", () => {
    mocked.state.error = new Error("Network unavailable");
    mocked.state.verifiedPath = mocked.pathname;
    const html = renderToStaticMarkup(createElement(AccessBoundary, null, "Protected page"));
    expect(html).toContain("Network unavailable");
    expect(html).toContain('role="alert"');
    expect(html).toContain("Retry permissions");
    expect(html).not.toContain("Protected page");
  });

  it("offers Super Admins facility management as an Admin tab, with one administration indicator", () => {
    signIn("SUPER_ADMIN");
    expect(renderToStaticMarkup(createElement(FacilitiesPage))).toContain("New plant");
    const shell = guardedShell();
    expect(shell).toContain('href="/app/facilities"');
    expect(shell).toContain("Protected page");
    expect(shell).toContain("Admin");
    expect(shell).not.toContain("Administration mode");
    expect(shell).not.toContain("Go to workspace selection");
  });

  it.each(["INVENTORY_ADMIN", "USER"] as const)("does not offer structure creation to %s", (role) => {
    signIn(role);
    expect(renderToStaticMarkup(createElement(FacilitiesPage))).not.toContain("New plant");
    expect(renderToStaticMarkup(createElement(FacilityDetailPage))).not.toContain("New project");
    expect(guardedShell()).not.toContain("Protected page");
    expect(renderToStaticMarkup(createElement(AppShell, null, ""))).not.toContain('href="/app/facilities"');
  });

  it("shows the Users tab only to roles that can read users", () => {
    signIn("USER");
    expect(renderToStaticMarkup(createElement(AppShell, null, ""))).not.toContain('href="/app/users"');
    signIn("INVENTORY_ADMIN");
    expect(renderToStaticMarkup(createElement(AppShell, null, ""))).toContain('href="/app/users"');
  });

  it("builds navigation without duplicates and without the removed sections", () => {
    signIn("SUPER_ADMIN");
    const shell = renderToStaticMarkup(createElement(AppShell, null, ""));
    for (const href of ['href="/app/dashboard"', 'href="/app/inventory/movements"', 'href="/app/notifications"']) {
      expect(shell, href).toContain(href);
    }
    expect(shell).not.toContain('href="/app/projects"');
    expect(shell).not.toContain("/select-facility");
    expect(shell).not.toContain("/app/reports");
    expect(shell).not.toContain("/app/audit-logs");
    expect(shell).not.toContain("Audit logs");
  });

  it("always renders Logout, a labelled avatar button, the workspace switcher and the mobile menu button", () => {
    signIn("USER");
    const shell = renderToStaticMarkup(createElement(AppShell, null, ""));
    expect(shell).toContain(">Logout<");
    expect(shell).toContain('aria-label="Account menu for Alex Admin"');
    expect(shell).toContain("Workspace: Plant › Tool Room › Line 1. Change workspace");
    expect(shell).toContain('aria-label="Open navigation menu"');
    expect(shell).toContain('aria-expanded="false"');
  });

  it("hides workspace-only tabs until a workspace is complete", () => {
    signIn("SUPER_ADMIN", { facility: null, department: null, project: null, workspaceStep: "facility" });
    const shell = renderToStaticMarkup(createElement(AppShell, null, ""));
    expect(shell).not.toContain('href="/app/dashboard"');
    expect(shell).not.toContain('href="/app/inventory/movements"');
    expect(shell).not.toContain('href="/app/projects"');
    expect(shell).toContain("Choose workspace");
  });

  it("still denies routes when the server returns no permissions", () => {
    signIn("SUPER_ADMIN");
    mocked.state.access!.permissions.clear();
    mocked.state.access!.session.permissions = [];
    const html = guardedShell();
    expect(html).toContain('aria-label="Loading page"');
    expect(html).not.toContain("Protected page");
  });

  it("renders the cached session immediately when moving to another page", () => {
    signIn("SUPER_ADMIN");
    mocked.pathname = "/app/settings";
    mocked.state.verifiedPath = "/app/facilities";
    expect(guardedShell()).toContain("Protected page");
  });

  it("allows the login form only after confirming the session is anonymous", () => {
    mocked.pathname = "/login";
    mocked.state.verifiedPath = "/login";
    expect(renderToStaticMarkup(createElement(AccessBoundary, null, "Sign in form"))).toContain("Sign in form");
  });
});

describe("login page", () => {
  it("names the product, offers a password toggle and a reset link", () => {
    const html = renderToStaticMarkup(createElement(LoginPage));
    expect(html).toContain("Tool Inventory Management System");
    expect(html).toContain('aria-label="Show password"');
    expect(html).toContain('href="/forgot-password"');
    expect(html).toContain("<svg");
  });
});
