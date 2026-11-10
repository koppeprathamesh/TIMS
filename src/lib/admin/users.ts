import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { recordAuditEvent } from "@/lib/audit";
import { hashPassword } from "@/lib/auth/password";
import {
  type RequestContext,
  assertDepartmentAccess,
  requireOrganizationContext,
  requirePermission,
  requireSuperAdmin,
} from "@/lib/authz/authorize";
import { PERMISSIONS, ROLES } from "@/lib/authz/permissions";

async function assertFacilitiesInOrganization(organizationId: string, facilityIds: string[]) {
  const unique = [...new Set(facilityIds)];
  const count = await prisma.facility.count({ where: { id: { in: unique }, organizationId } });
  if (count !== unique.length) throw AppError.badRequest("One or more plants do not exist.");
  return unique;
}

// Scope is checked before existence so out-of-scope ids are always rejected as forbidden.
async function assertDepartmentsGrantable(ctx: RequestContext, organizationId: string, departmentIds: string[]) {
  const unique = [...new Set(departmentIds)];
  for (const id of unique) assertDepartmentAccess(ctx, id);
  const count = await prisma.department.count({ where: { id: { in: unique }, facility: { organizationId } } });
  if (count !== unique.length) throw AppError.badRequest("One or more projects do not exist.");
  return unique;
}

// Super Admins manage everyone. Inventory Admins only manage standard Users inside their scope.
async function assertCanManageTarget(ctx: RequestContext, organizationId: string, userId: string) {
  const target = await prisma.user.findFirst({
    where: { id: userId, memberships: { some: { organizationId } } },
    select: { id: true, role: true, departmentAccess: { select: { departmentId: true } } },
  });
  if (!target) throw AppError.notFound("User not found.");
  if (ctx.unrestricted) return target;

  const inScope = target.departmentAccess.some((a) => ctx.grantedDepartmentIds.has(a.departmentId));
  if (target.role !== ROLES.USER || !inScope) {
    throw AppError.forbidden("You can only manage users within your assigned projects.");
  }
  return target;
}

export async function listUsers(ctx: RequestContext) {
  requirePermission(ctx, PERMISSIONS.USER_READ);
  const organizationId = requireOrganizationContext(ctx);

  const users = await prisma.user.findMany({
    where: {
      memberships: { some: { organizationId } },
      ...(ctx.unrestricted
        ? {}
        : { role: ROLES.USER, departmentAccess: { some: { departmentId: { in: [...ctx.grantedDepartmentIds] } } } }),
    },
    select: {
      id: true,
      email: true,
      displayName: true,
      role: true,
      status: true,
      createdAt: true,
      adminFacilities: { select: { facility: { select: { id: true, name: true } } } },
      departmentAccess: {
        select: {
          department: { select: { id: true, name: true, facility: { select: { id: true, name: true } } } },
        },
      },
    },
    orderBy: { displayName: "asc" },
  });

  return users.map((u) => ({
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    role: u.role,
    status: u.status,
    createdAt: u.createdAt,
    facilities: u.adminFacilities.map((a) => a.facility),
    // Admins only see the part of a user's access that falls inside their own scope.
    departments: u.departmentAccess
      .map((a) => a.department)
      .filter((d) => ctx.unrestricted || ctx.grantedDepartmentIds.has(d.id)),
  }));
}

export async function createUser(
  ctx: RequestContext,
  input: {
    email: string;
    displayName: string;
    password: string;
    role: typeof ROLES.INVENTORY_ADMIN | typeof ROLES.USER;
    facilityIds?: string[];
    departmentIds?: string[];
  }
) {
  requirePermission(ctx, PERMISSIONS.USER_MANAGE);
  const organizationId = requireOrganizationContext(ctx);

  let facilityIds: string[] = [];
  let departmentIds: string[] = [];
  if (input.role === ROLES.INVENTORY_ADMIN) {
    if (!ctx.unrestricted) throw AppError.forbidden("Only a Super Admin can create Inventory Admins.");
    facilityIds = await assertFacilitiesInOrganization(organizationId, input.facilityIds ?? []);
    if (facilityIds.length === 0) throw AppError.badRequest("Assign at least one plant.");
  } else {
    departmentIds = await assertDepartmentsGrantable(ctx, organizationId, input.departmentIds ?? []);
    if (departmentIds.length === 0) throw AppError.badRequest("Assign at least one project.");
  }

  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw AppError.conflict("A user with this email already exists.");

  const passwordHash = await hashPassword(input.password);
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: { email: input.email, displayName: input.displayName, passwordHash, role: input.role },
    });
    await tx.organizationMembership.create({ data: { organizationId, userId: created.id } });
    if (facilityIds.length) {
      await tx.inventoryAdminFacility.createMany({
        data: facilityIds.map((facilityId) => ({ userId: created.id, facilityId, grantedById: ctx.userId })),
      });
    }
    if (departmentIds.length) {
      await tx.userDepartmentAccess.createMany({
        data: departmentIds.map((departmentId) => ({ userId: created.id, departmentId, grantedById: ctx.userId })),
      });
    }
    await recordAuditEvent(
      {
        organizationId,
        actorId: ctx.userId,
        action: "user.create",
        resourceType: "User",
        resourceId: created.id,
        metadata: { email: created.email, role: created.role, facilityIds, departmentIds },
      },
      tx
    );
    return created;
  });

  return { id: user.id, email: user.email, displayName: user.displayName, role: user.role, status: user.status };
}

export async function updateUser(
  ctx: RequestContext,
  userId: string,
  input: { displayName?: string; status?: "ACTIVE" | "INACTIVE"; password?: string }
) {
  requirePermission(ctx, PERMISSIONS.USER_MANAGE);
  const organizationId = requireOrganizationContext(ctx);
  await assertCanManageTarget(ctx, organizationId, userId);

  if (input.status === "INACTIVE" && userId === ctx.userId) {
    throw AppError.conflict("You cannot deactivate your own account.");
  }

  // Password resets and deactivation bump tokenVersion, ending every session the user already has.
  const revokeSessions = Boolean(input.password) || input.status === "INACTIVE";
  const passwordHash = input.password ? await hashPassword(input.password) : null;
  const user = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: userId },
      data: {
        ...(input.displayName ? { displayName: input.displayName } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(passwordHash ? { passwordHash, failedLoginCount: 0, lockedUntil: null } : {}),
        ...(revokeSessions ? { tokenVersion: { increment: 1 } } : {}),
      },
    });
    await recordAuditEvent(
      {
        organizationId,
        actorId: ctx.userId,
        action: input.password ? "user.password_reset" : "user.update",
        resourceType: "User",
        resourceId: userId,
        metadata: { fields: Object.keys(input).filter((k) => k !== "password"), passwordChanged: !!input.password },
      },
      tx
    );
    return updated;
  });

  return { id: user.id, email: user.email, displayName: user.displayName, role: user.role, status: user.status };
}

// Inventory Admins: facility grants (Super Admin only). Users: department grants (within the caller's scope).
export async function setUserAccess(
  ctx: RequestContext,
  userId: string,
  input: { facilityIds?: string[]; departmentIds?: string[] }
) {
  requirePermission(ctx, PERMISSIONS.USER_MANAGE);
  const organizationId = requireOrganizationContext(ctx);
  if (userId === ctx.userId) throw AppError.conflict("You cannot change your own access.");

  const target = await assertCanManageTarget(ctx, organizationId, userId);

  if (target.role === ROLES.INVENTORY_ADMIN) {
    requireSuperAdmin(ctx);
    if (!input.facilityIds) throw AppError.badRequest("facilityIds is required for Inventory Admins.");
    const facilityIds = await assertFacilitiesInOrganization(organizationId, input.facilityIds);
    if (facilityIds.length === 0) throw AppError.badRequest("Assign at least one plant.");

    await prisma.$transaction(async (tx) => {
      await tx.inventoryAdminFacility.deleteMany({ where: { userId } });
      await tx.inventoryAdminFacility.createMany({
        data: facilityIds.map((facilityId) => ({ userId, facilityId, grantedById: ctx.userId })),
      });
      await recordAuditEvent(
        {
          organizationId,
          actorId: ctx.userId,
          action: "user.facilities_set",
          resourceType: "User",
          resourceId: userId,
          metadata: { facilityIds },
        },
        tx
      );
    });
    return;
  }

  if (target.role !== ROLES.USER) throw AppError.conflict("Super Admins are not scoped to plants or projects.");
  if (!input.departmentIds) throw AppError.badRequest("departmentIds is required for Users.");
  const departmentIds = await assertDepartmentsGrantable(ctx, organizationId, input.departmentIds);

  // Grants outside the caller's own scope belong to other admins and are left untouched.
  await prisma.$transaction(async (tx) => {
    await tx.userDepartmentAccess.deleteMany({
      where: ctx.unrestricted ? { userId } : { userId, departmentId: { in: [...ctx.grantedDepartmentIds] } },
    });
    await tx.userDepartmentAccess.createMany({
      data: departmentIds.map((departmentId) => ({ userId, departmentId, grantedById: ctx.userId })),
    });
    await recordAuditEvent(
      {
        organizationId,
        actorId: ctx.userId,
        action: "user.departments_set",
        resourceType: "User",
        resourceId: userId,
        metadata: { departmentIds },
      },
      tx
    );
  });
}
