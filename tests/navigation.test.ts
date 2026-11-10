import { describe, expect, it } from "vitest";
import { navigationRedirect, workspaceDestination, type NavigationSession } from "@/lib/navigation";
import { permissionsForRole, type RoleCode } from "@/lib/authz/permissions";

function session(role: RoleCode = "SUPER_ADMIN", overrides: Partial<NavigationSession> = {}): NavigationSession {
  return {
    user: { id: "u1", displayName: "Name", email: "name@test.local" },
    organization: { id: "o1", name: "Organization" },
    facility: { id: "f1", name: "Facility" },
    department: { id: "d1", name: "Department" },
    project: { id: "p1", name: "Project" },
    workspaceStep: "ready",
    role, permissions: [...permissionsForRole(role)],
    ...overrides,
  };
}

const noWorkspace = { facility: null, department: null, project: null, workspaceStep: "facility" as const };

describe("navigation policy", () => {
  it.each(["/app/dashboard", "/app/facilities", "/app/workspace", "/app/projects", "/tool/t1"])(
    "redirects anonymous destination %s to login", (path) => {
      expect(navigationRedirect(path, null)).toBe("/login");
    }
  );

  it("does not intercept public pages", () => {
    for (const path of ["/login", "/forgot-password", "/reset-password", "/not-found"]) {
      expect(navigationRedirect(path, null), path).toBeNull();
    }
  });

  it.each(["/app/facilities", "/app/facilities/f1", "/app/users", "/app/settings"])(
    "allows Super Admin administration without a workspace: %s", (path) => {
      expect(navigationRedirect(path, session("SUPER_ADMIN", noWorkspace))).toBeNull();
    }
  );

  it.each(["INVENTORY_ADMIN", "USER"] as const)("routes %s away from facility administration", (role) => {
    expect(navigationRedirect("/app/facilities", session(role))).toBe("/app/dashboard");
    expect(navigationRedirect("/app/facilities/f1", session(role, { project: null, workspaceStep: "project" }))).toBe("/app/projects");
    expect(navigationRedirect("/app/facilities/f1", session(role, noWorkspace))).toBe("/app/workspace");
  });

  it("sends users without a complete workspace to the picker, but keeps projects reachable", () => {
    const s = session("SUPER_ADMIN", noWorkspace);
    expect(navigationRedirect("/app/dashboard", s)).toBe("/app/workspace");
    expect(navigationRedirect("/app/inventory/movements", s)).toBe("/app/workspace");
    expect(navigationRedirect("/app/workspace", s)).toBeNull();
    expect(navigationRedirect("/app/projects", s)).toBeNull();
  });

  it("lets a department with no chosen project open Projects instead of a dead end", () => {
    const s = session("SUPER_ADMIN", { project: null, workspaceStep: "project" });
    expect(navigationRedirect("/app/dashboard", s)).toBe("/app/projects");
    expect(navigationRedirect("/app/projects", s)).toBeNull();
    expect(workspaceDestination(s)).toBe("/app/projects");
  });

  it("requires a department before the workspace counts as chosen", () => {
    const s = session("USER", { department: null, project: null, workspaceStep: "department" });
    expect(navigationRedirect("/app/dashboard", s)).toBe("/app/workspace");
    expect(workspaceDestination(s)).toBe("/app/workspace");
  });

  it("maps the retired wizard URLs onto the new screens", () => {
    const s = session("USER");
    expect(navigationRedirect("/select-facility", s)).toBe("/app/workspace");
    expect(navigationRedirect("/select-department", s)).toBe("/app/workspace");
    expect(navigationRedirect("/select-project", s)).toBe("/app/projects");
  });

  it("uses fresh permissions for write and legacy routes", () => {
    const s = session("USER");
    for (const path of ["/app/tools/new", "/app/tools/t1/edit", "/edit-tool/t1", "/app/users", "/app/inventory/movements/new"]) {
      expect(navigationRedirect(path, s), path).toBe("/unauthorized");
    }
    expect(navigationRedirect("/tool/t1", s)).toBeNull();
    expect(navigationRedirect("/dashboard", s)).toBeNull();
  });

  it("lets Inventory Admins add and edit tools", () => {
    const s = session("INVENTORY_ADMIN");
    for (const path of ["/app/tools/new", "/app/tools/t1/edit", "/app/inventory/movements/new"]) {
      expect(navigationRedirect(path, s), path).toBeNull();
    }
  });

  it("no longer serves the removed reports and audit-log sections", () => {
    const s = session("SUPER_ADMIN");
    for (const path of ["/app/reports", "/app/audit-logs"]) {
      expect(s.permissions.some((p) => p.startsWith("report.") || p.startsWith("audit."))).toBe(false);
      expect(navigationRedirect(path, s), path).toBeNull(); // falls through to Next's 404
    }
  });

  it("does not bypass missing membership or permissions because the role says Super Admin", () => {
    expect(navigationRedirect("/app/facilities", session("SUPER_ADMIN", { permissions: [] }))).toBe("/unauthorized");
    expect(navigationRedirect("/app/facilities", session("SUPER_ADMIN", { organization: null }))).toBe("/unauthorized");
    expect(navigationRedirect("/unauthorized", session("SUPER_ADMIN", { organization: null }))).toBeNull();
  });

  it("sends authenticated login-history entries to the currently valid destination", () => {
    expect(navigationRedirect("/login", session("USER", { department: null, project: null, workspaceStep: "department" }))).toBe("/app/workspace");
    expect(navigationRedirect("/login", session("USER"))).toBe("/app/dashboard");
    expect(workspaceDestination(session("USER"))).toBe("/app/dashboard");
  });
});
