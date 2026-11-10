import { cookies } from "next/headers";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { SESSION_COOKIE_NAME, verifySession } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import {
  ROLES,
  isRoleCode,
  permissionsForRole,
  type PermissionCode,
  type RoleCode,
} from "@/lib/authz/permissions";

export interface RequestContext {
  userId: string;
  /** Present on contexts loaded from a session; used to re-issue the session cookie. */
  tokenVersion?: number;
  organizationId: string | null;
  facilityId: string | null;
  departmentId: string | null;
  projectId: string | null;
  role: RoleCode;
  permissions: Set<string>;
  /** Super Admin only: bypasses facility/department/project scoping. */
  unrestricted: boolean;
  /** Everyone else is limited to exactly these ids (an empty set means no access). */
  grantedFacilityIds: Set<string>;
  grantedDepartmentIds: Set<string>;
  grantedProjectIds: Set<string>;
}

export interface AccessScope {
  unrestricted: boolean;
  facilityIds: Set<string>;
  departmentIds: Set<string>;
  projectIds: Set<string>;
}

const NO_SCOPE: AccessScope = {
  unrestricted: false,
  facilityIds: new Set(),
  departmentIds: new Set(),
  projectIds: new Set(),
};

// Inventory Admins are scoped by their facility grants; Users by their department grants.
// Departments and projects always derive from those grants, so revoking a grant takes effect immediately.
export async function resolveAccessScope(
  userId: string,
  role: RoleCode,
  organizationId: string
): Promise<AccessScope> {
  if (role === ROLES.SUPER_ADMIN) {
    return { unrestricted: true, facilityIds: new Set(), departmentIds: new Set(), projectIds: new Set() };
  }

  let facilityIds: string[];
  let departmentIds: string[];

  if (role === ROLES.INVENTORY_ADMIN) {
    const grants = await prisma.inventoryAdminFacility.findMany({
      where: { userId, facility: { organizationId } },
      select: { facilityId: true },
    });
    facilityIds = grants.map((g) => g.facilityId);
    const departments = await prisma.department.findMany({
      where: { facilityId: { in: facilityIds } },
      select: { id: true },
    });
    departmentIds = departments.map((d) => d.id);
  } else {
    const grants = await prisma.userDepartmentAccess.findMany({
      where: { userId, department: { facility: { organizationId } } },
      select: { departmentId: true, department: { select: { facilityId: true } } },
    });
    departmentIds = grants.map((g) => g.departmentId);
    facilityIds = [...new Set(grants.map((g) => g.department.facilityId))];
  }

  const projects = await prisma.project.findMany({
    where: { organizationId, departmentId: { in: departmentIds } },
    select: { id: true },
  });

  return {
    unrestricted: false,
    facilityIds: new Set(facilityIds),
    departmentIds: new Set(departmentIds),
    projectIds: new Set(projects.map((p) => p.id)),
  };
}

// Authentication + fresh permission resolution. Role and scope are always
// recomputed from the database — the session token never carries them.
export async function getRequestContext(): Promise<RequestContext> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) throw AppError.unauthorized();

  const session = verifySession(token);
  if (!session) throw AppError.unauthorized("Your session has expired. Please sign in again.");

  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user || user.status !== "ACTIVE") {
    throw AppError.unauthorized("Your account is not active.");
  }
  // Password resets and deactivation bump tokenVersion, which revokes every session issued earlier.
  if ((session.tv ?? 0) !== user.tokenVersion) {
    throw AppError.unauthorized("Your session has expired. Please sign in again.");
  }

  const role: RoleCode = isRoleCode(user.role) ? user.role : ROLES.USER;
  const membership = session.organizationId
    ? await prisma.organizationMembership.findFirst({
        where: { userId: user.id, organizationId: session.organizationId, status: "ACTIVE" },
      })
    : null;

  // Without an active organization membership the user holds no permissions at all.
  const scope = membership
    ? await resolveAccessScope(user.id, role, session.organizationId as string)
    : NO_SCOPE;

  return {
    userId: user.id,
    tokenVersion: user.tokenVersion,
    organizationId: membership ? (session.organizationId ?? null) : null,
    facilityId: session.facilityId ?? null,
    departmentId: session.departmentId ?? null,
    projectId: session.projectId ?? null,
    role,
    permissions: membership ? permissionsForRole(role) : new Set<string>(),
    unrestricted: scope.unrestricted,
    grantedFacilityIds: scope.facilityIds,
    grantedDepartmentIds: scope.departmentIds,
    grantedProjectIds: scope.projectIds,
  };
}

export function scopeOf(ctx: RequestContext): AccessScope {
  return {
    unrestricted: ctx.unrestricted,
    facilityIds: ctx.grantedFacilityIds,
    departmentIds: ctx.grantedDepartmentIds,
    projectIds: ctx.grantedProjectIds,
  };
}

export function requirePermission(ctx: RequestContext, permission: PermissionCode) {
  if (!ctx.permissions.has(permission)) {
    throw AppError.forbidden(`Missing required permission: ${permission}`);
  }
}

export function isSuperAdmin(ctx: RequestContext) {
  return ctx.role === ROLES.SUPER_ADMIN;
}

export function requireSuperAdmin(ctx: RequestContext) {
  if (!isSuperAdmin(ctx)) throw AppError.forbidden("Only a Super Admin can perform this action.");
}

export function canAccessFacility(ctx: RequestContext, facilityId: string) {
  return ctx.unrestricted || ctx.grantedFacilityIds.has(facilityId);
}

export function canAccessDepartment(ctx: RequestContext, departmentId: string) {
  return ctx.unrestricted || ctx.grantedDepartmentIds.has(departmentId);
}

export function assertFacilityAccess(ctx: RequestContext, facilityId: string) {
  if (!canAccessFacility(ctx, facilityId)) {
    throw AppError.forbidden("You do not have access to this plant.");
  }
}

export function assertDepartmentAccess(ctx: RequestContext, departmentId: string) {
  if (!canAccessDepartment(ctx, departmentId)) {
    throw AppError.forbidden("You do not have access to this project.");
  }
}

export function assertProjectAccess(ctx: RequestContext, projectId: string | null | undefined) {
  if (!projectId) return;
  if (ctx.unrestricted || ctx.grantedProjectIds.has(projectId)) return;
  throw AppError.forbidden("You do not have access to this part.");
}

/** Prisma `id` filter limiting a facility query to the caller's scope; `undefined` means no restriction. */
export function facilityIdFilter(ctx: RequestContext) {
  return ctx.unrestricted ? undefined : { in: [...ctx.grantedFacilityIds] };
}

export function departmentIdFilter(ctx: RequestContext) {
  return ctx.unrestricted ? undefined : { in: [...ctx.grantedDepartmentIds] };
}

export function projectIdFilter(ctx: RequestContext) {
  return ctx.unrestricted ? undefined : { in: [...ctx.grantedProjectIds] };
}

// Tools visible in the selected context: project, else department, else facility. This is the
// single definition of "which tools can this caller see" and is used by lists, summaries, detail,
// edit and movement routes so every surface agrees.
// - Tools without a project only appear at facility level, and only where they hold stock
//   (or always, with `includeUnassigned`, for movement paths that must still reach org-wide tools).
// - A selected project/department must itself be inside the caller's grants.
export function toolScopeWhere(
  ctx: RequestContext,
  facilityId: string,
  opts: { includeUnassigned?: boolean } = {}
): Prisma.ToolWhereInput {
  const allowed = projectIdFilter(ctx);
  const unassigned: Prisma.ToolWhereInput = opts.includeUnassigned
    ? { projectId: null }
    : { projectId: null, balances: { some: { facilityId } } };
  const inFacility = { department: { facilityId } };

  let scoped: Prisma.ToolWhereInput;
  if (ctx.projectId) {
    scoped = allowed && !ctx.grantedProjectIds.has(ctx.projectId)
      ? { id: { in: [] } }
      : { projectId: ctx.projectId, project: inFacility };
    return opts.includeUnassigned ? { OR: [scoped, { projectId: null }] } : scoped;
  }
  if (ctx.departmentId) {
    scoped = { project: { departmentId: ctx.departmentId, ...(allowed ? { id: allowed } : {}) } };
    return opts.includeUnassigned ? { OR: [scoped, { projectId: null }] } : scoped;
  }
  return {
    OR: [{ project: { ...inFacility, ...(allowed ? { id: allowed } : {}) } }, unassigned],
  };
}

// Movements are visible when they happened in the facility and touch at least one tool in scope.
export function movementScopeWhere(ctx: RequestContext, facilityId: string): Prisma.InventoryMovementWhereInput {
  return {
    facilityId,
    lines: { some: { tool: toolScopeWhere(ctx, facilityId, { includeUnassigned: true }) } },
  };
}

// Loads a tool only when it is inside the caller's scope; anything else is reported as not found
// so ids of hidden tools cannot be probed.
export async function requireToolInScope(
  ctx: RequestContext,
  toolId: string,
  opts: { includeUnassigned?: boolean } = {}
) {
  const organizationId = requireOrganizationContext(ctx);
  const facilityId = requireFacilityContext(ctx);
  const tool = await prisma.tool.findFirst({
    where: { AND: [{ id: toolId, organizationId }, toolScopeWhere(ctx, facilityId, opts)] },
  });
  if (!tool) throw AppError.notFound("Tool not found.");
  return tool;
}

export function requireOrganizationContext(ctx: RequestContext): string {
  if (!ctx.organizationId) {
    throw AppError.badRequest("No organization context selected.");
  }
  return ctx.organizationId;
}

// The selected facility is re-checked on every request so a revoked grant stops working immediately.
export function requireFacilityContext(ctx: RequestContext): string {
  if (!ctx.facilityId) {
    throw AppError.badRequest("No plant context selected.");
  }
  assertFacilityAccess(ctx, ctx.facilityId);
  return ctx.facilityId;
}
