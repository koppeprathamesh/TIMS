import type { RoleCode } from "@/lib/authz/permissions";

export type WorkspaceStep = "facility" | "department" | "project" | "ready";

export interface WorkspaceEntity {
  id: string;
  name: string;
}

export interface NavigationSession {
  user: { id: string; displayName: string; email: string };
  organization: WorkspaceEntity | null;
  facility: WorkspaceEntity | null;
  department: WorkspaceEntity | null;
  project: WorkspaceEntity | null;
  workspaceStep: WorkspaceStep;
  role: RoleCode;
  permissions: string[];
}

export const WORKSPACE_PATH = "/app/workspace";
export const PROJECTS_PATH = "/app/projects";
export const DASHBOARD_PATH = "/app/dashboard";

// Specific write routes must precede their read-only parents.
const ROUTE_PERMISSIONS: [RegExp, string][] = [
  [/^\/app\/tools\/new$/, "tool.create"],
  [/^\/app\/tools\/[^/]+\/edit$/, "tool.update"],
  [/^\/app\/tools\/[^/]+\/movements\/new$/, "movement.create"],
  [/^\/app\/inventory\/movements\/new$/, "movement.create"],
  [/^\/app\/tools(\/|$)/, "tool.read"],
  [/^\/app\/dashboard$/, "inventory.summary.read"],
  [/^\/app\/users(\/|$)/, "user.read"],
  [/^\/app\/settings(\/|$)/, "settings.read"],
  [/^\/app\/machines(\/|$)/, "machine.read"],
  [/^\/app\/facilities(\/|$)/, "facility.manage"],
  [/^\/app\/departments(\/|$)/, "department.manage"],
  [/^\/app\/projects(\/|$)/, "project.read"],
  [/^\/app\/workspace(\/|$)/, "facility.read"],
  [/^\/app\/inventory(\/|$)/, "movement.read"],
];

// Retired URLs that still resolve so old bookmarks and history entries keep working.
const LEGACY_WORKSPACE_PATHS = /^\/(select-facility|select-department)$/;
const LEGACY_PROJECT_PATH = /^\/select-project$/;

export function isProtectedRoute(path: string) {
  return /^\/(app|select-facility|select-department|select-project|dashboard|tool|edit-tool|unauthorized)(\/|$)/.test(path);
}

export function isAdministrationRoute(path: string) {
  return /^\/app\/(facilities|departments|users|settings)(\/|$)/.test(path);
}

// Pages that work before a complete workspace exists: choosing one, managing projects
// (including creating the first), notifications and administration.
function isWorkspaceFreeRoute(path: string) {
  return (
    isAdministrationRoute(path) ||
    /^\/app\/(workspace|projects|notifications)(\/|$)/.test(path)
  );
}

export function workspaceDestination(session: Pick<NavigationSession, "organization" | "facility" | "workspaceStep">) {
  if (!session.organization) return "/unauthorized";
  if (!session.facility || session.workspaceStep === "facility" || session.workspaceStep === "department") {
    return WORKSPACE_PATH;
  }
  if (session.workspaceStep === "project") return PROJECTS_PATH;
  return DASHBOARD_PATH;
}

export function canonicalPath(path: string) {
  if (LEGACY_WORKSPACE_PATHS.test(path)) return WORKSPACE_PATH;
  if (LEGACY_PROJECT_PATH.test(path)) return PROJECTS_PATH;
  if (path === "/dashboard") return DASHBOARD_PATH;
  if (path.startsWith("/edit-tool/")) return `${path.replace(/^\/edit-tool\//, "/app/tools/")}/edit`;
  return path.replace(/^\/tool\//, "/app/tools/");
}

// null means allowed. Only fixed application destinations are returned.
export function navigationRedirect(path: string, session: NavigationSession | null): string | null {
  if (!session) return isProtectedRoute(path) ? "/login" : null;
  if (path === "/login") return workspaceDestination(session);
  if (!isProtectedRoute(path) || path === "/unauthorized") return null;
  if (!session.organization) return "/unauthorized";

  const canonical = canonicalPath(path);
  if (canonical !== path && (LEGACY_WORKSPACE_PATHS.test(path) || LEGACY_PROJECT_PATH.test(path))) {
    return canonical;
  }
  if (/^\/app\/(facilities|departments)(\/|$)/.test(canonical) && session.role !== "SUPER_ADMIN") {
    return workspaceDestination(session);
  }
  const required = ROUTE_PERMISSIONS.find(([pattern]) => pattern.test(canonical))?.[1];
  if (required && !session.permissions.includes(required)) return "/unauthorized";
  if (isWorkspaceFreeRoute(canonical)) return null;
  if (session.workspaceStep !== "ready") return workspaceDestination(session);
  return null;
}
