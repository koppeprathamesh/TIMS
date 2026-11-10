import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { recordAuditEvent } from "@/lib/audit";
import {
  type RequestContext,
  assertDepartmentAccess,
  assertFacilityAccess,
  assertProjectAccess,
  departmentIdFilter,
  facilityIdFilter,
  projectIdFilter,
  requireOrganizationContext,
  requirePermission,
} from "@/lib/authz/authorize";
import { PERMISSIONS } from "@/lib/authz/permissions";
import { uniqueCode } from "@/lib/validation/codes";

interface Presentation {
  description?: string | null;
  imageUrl?: string | null;
}

// ---- Facilities ----------------------------------------------------------

export async function listFacilities(ctx: RequestContext, opts: { includeInactive?: boolean } = {}) {
  requirePermission(ctx, PERMISSIONS.FACILITY_READ);
  const organizationId = requireOrganizationContext(ctx);

  return prisma.facility.findMany({
    where: {
      organizationId,
      // Only Super Admins ever see deactivated facilities.
      ...(opts.includeInactive && ctx.unrestricted ? {} : { status: "ACTIVE" }),
      id: facilityIdFilter(ctx),
    },
    include: { _count: { select: { departments: true } } },
    orderBy: { name: "asc" },
  });
}

export async function createFacility(
  ctx: RequestContext,
  input: { name: string; code: string } & Presentation
) {
  requirePermission(ctx, PERMISSIONS.FACILITY_MANAGE);
  const organizationId = requireOrganizationContext(ctx);

  if (await prisma.facility.findFirst({ where: { organizationId, code: input.code } })) {
    throw AppError.conflict("A plant with this code already exists.");
  }
  const facility = await prisma.$transaction(async (tx) => {
    const created = await tx.facility.create({
      data: {
        organizationId,
        name: input.name,
        code: input.code,
        description: input.description ?? null,
        imageUrl: input.imageUrl ?? null,
      },
    });
    await recordAuditEvent(
      {
        organizationId,
        actorId: ctx.userId,
        action: "facility.create",
        resourceType: "Facility",
        resourceId: created.id,
        metadata: { code: created.code, name: created.name },
      },
      tx
    );
    return created;
  });
  return facility;
}

export async function updateFacility(
  ctx: RequestContext,
  facilityId: string,
  input: { name?: string; status?: "ACTIVE" | "INACTIVE" } & Presentation
) {
  requirePermission(ctx, PERMISSIONS.FACILITY_MANAGE);
  const organizationId = requireOrganizationContext(ctx);

  const existing = await prisma.facility.findFirst({ where: { id: facilityId, organizationId } });
  if (!existing) throw AppError.notFound("Plant not found.");

  return prisma.$transaction(async (tx) => {
    const facility = await tx.facility.update({ where: { id: facilityId }, data: input });
    await recordAuditEvent(
      {
        organizationId,
        actorId: ctx.userId,
        action: "facility.update",
        resourceType: "Facility",
        resourceId: facilityId,
        metadata: { fields: Object.keys(input) },
      },
      tx
    );
    return facility;
  });
}

// ---- Departments ---------------------------------------------------------

// Without a facility filter, returns every department the caller may access.
export async function listDepartments(
  ctx: RequestContext,
  opts: { facilityId?: string | null; includeInactive?: boolean } = {}
) {
  requirePermission(ctx, PERMISSIONS.DEPARTMENT_READ);
  const organizationId = requireOrganizationContext(ctx);
  if (opts.facilityId) assertFacilityAccess(ctx, opts.facilityId);

  return prisma.department.findMany({
    where: {
      facility: { organizationId },
      ...(opts.facilityId ? { facilityId: opts.facilityId } : {}),
      ...(opts.includeInactive && ctx.unrestricted ? {} : { status: "ACTIVE" }),
      id: departmentIdFilter(ctx),
    },
    include: {
      facility: { select: { id: true, name: true, code: true } },
      _count: { select: { projects: true } },
    },
    orderBy: [{ facility: { name: "asc" } }, { name: "asc" }],
  });
}

export async function createDepartment(
  ctx: RequestContext,
  input: { facilityId: string; name: string; code: string } & Presentation
) {
  requirePermission(ctx, PERMISSIONS.DEPARTMENT_MANAGE);
  const organizationId = requireOrganizationContext(ctx);

  const facility = await prisma.facility.findFirst({ where: { id: input.facilityId, organizationId } });
  if (!facility) throw AppError.notFound("Plant not found.");
  if (await prisma.department.findFirst({ where: { facilityId: facility.id, code: input.code } })) {
    throw AppError.conflict("A project with this code already exists in this plant.");
  }

  return prisma.$transaction(async (tx) => {
    const department = await tx.department.create({
      data: {
        facilityId: facility.id,
        name: input.name,
        code: input.code,
        description: input.description ?? null,
        imageUrl: input.imageUrl ?? null,
      },
    });
    await recordAuditEvent(
      {
        organizationId,
        actorId: ctx.userId,
        action: "department.create",
        resourceType: "Department",
        resourceId: department.id,
        metadata: { code: department.code, facilityId: facility.id },
      },
      tx
    );
    return department;
  });
}

export async function updateDepartment(
  ctx: RequestContext,
  departmentId: string,
  input: { name?: string; status?: "ACTIVE" | "INACTIVE" } & Presentation
) {
  requirePermission(ctx, PERMISSIONS.DEPARTMENT_MANAGE);
  const organizationId = requireOrganizationContext(ctx);

  const existing = await prisma.department.findFirst({ where: { id: departmentId, facility: { organizationId } } });
  if (!existing) throw AppError.notFound("Project not found.");

  return prisma.$transaction(async (tx) => {
    const department = await tx.department.update({ where: { id: departmentId }, data: input });
    await recordAuditEvent(
      {
        organizationId,
        actorId: ctx.userId,
        action: "department.update",
        resourceType: "Department",
        resourceId: departmentId,
        metadata: { fields: Object.keys(input) },
      },
      tx
    );
    return department;
  });
}

// ---- Projects ------------------------------------------------------------

export async function listProjects(
  ctx: RequestContext,
  opts: { departmentId?: string | null; facilityId?: string | null; includeArchived?: boolean } = {}
) {
  requirePermission(ctx, PERMISSIONS.PROJECT_READ);
  const organizationId = requireOrganizationContext(ctx);
  if (opts.departmentId) assertDepartmentAccess(ctx, opts.departmentId);
  if (opts.facilityId) assertFacilityAccess(ctx, opts.facilityId);

  return prisma.project.findMany({
    where: {
      organizationId,
      ...(opts.departmentId ? { departmentId: opts.departmentId } : {}),
      ...(opts.facilityId ? { department: { facilityId: opts.facilityId } } : {}),
      // Only roles that can modify projects get to see archived ones.
      ...(opts.includeArchived && ctx.permissions.has(PERMISSIONS.PROJECT_UPDATE) ? {} : { status: "ACTIVE" }),
      id: projectIdFilter(ctx),
    },
    include: { department: { select: { id: true, name: true, facility: { select: { id: true, name: true } } } } },
    orderBy: { name: "asc" },
  });
}

export async function createProject(
  ctx: RequestContext,
  input: { departmentId: string; name: string; code?: string | null }
) {
  requirePermission(ctx, PERMISSIONS.PROJECT_CREATE);
  const organizationId = requireOrganizationContext(ctx);

  assertDepartmentAccess(ctx, input.departmentId);
  const department = await prisma.department.findFirst({
    where: { id: input.departmentId, facility: { organizationId } },
  });
  if (!department) throw AppError.notFound("Project not found.");

  // The code is no longer entered by users; derive a unique one from the name when none is given.
  let code = input.code?.trim();
  if (code) {
    if (await prisma.project.findFirst({ where: { organizationId, code } })) {
      throw AppError.conflict("A part with this code already exists.");
    }
  } else {
    const existing = await prisma.project.findMany({ where: { organizationId }, select: { code: true } });
    code = uniqueCode(input.name, "PROJECT", new Set(existing.map((p) => p.code)));
  }
  const projectCode = code;

  return prisma.$transaction(async (tx) => {
    const project = await tx.project.create({
      data: { organizationId, departmentId: department.id, name: input.name, code: projectCode },
    });
    await recordAuditEvent(
      {
        organizationId,
        actorId: ctx.userId,
        action: "project.create",
        resourceType: "Project",
        resourceId: project.id,
        metadata: { code: project.code, departmentId: department.id },
      },
      tx
    );
    return project;
  });
}

async function loadManagedProject(ctx: RequestContext, organizationId: string, projectId: string) {
  const project = await prisma.project.findFirst({ where: { id: projectId, organizationId } });
  if (!project) throw AppError.notFound("Part not found.");
  // Projects without a department can only be managed by a Super Admin.
  assertProjectAccess(ctx, project.id);
  return project;
}

export async function updateProject(
  ctx: RequestContext,
  projectId: string,
  input: { name?: string; status?: "ACTIVE" | "ARCHIVED" }
) {
  requirePermission(ctx, PERMISSIONS.PROJECT_UPDATE);
  if (input.status === "ARCHIVED") requirePermission(ctx, PERMISSIONS.PROJECT_ARCHIVE);
  const organizationId = requireOrganizationContext(ctx);
  await loadManagedProject(ctx, organizationId, projectId);

  return prisma.$transaction(async (tx) => {
    const project = await tx.project.update({ where: { id: projectId }, data: input });
    await recordAuditEvent(
      {
        organizationId,
        actorId: ctx.userId,
        action: "project.update",
        resourceType: "Project",
        resourceId: projectId,
        metadata: { fields: Object.keys(input) },
      },
      tx
    );
    return project;
  });
}

export async function deleteProject(ctx: RequestContext, projectId: string) {
  requirePermission(ctx, PERMISSIONS.PROJECT_ARCHIVE);
  const organizationId = requireOrganizationContext(ctx);
  const project = await loadManagedProject(ctx, organizationId, projectId);

  if (await prisma.inventoryMovement.count({ where: { projectId } })) {
    throw AppError.conflict("This part has inventory movements and cannot be deleted. Archive it instead.");
  }
  // Deleting would silently turn the project's tools into unassigned, org-wide tools.
  if (await prisma.tool.count({ where: { projectId } })) {
    throw AppError.conflict("This part still has tools and cannot be deleted. Archive it instead.");
  }
  await prisma.$transaction(async (tx) => {
    await tx.project.delete({ where: { id: projectId } });
    await recordAuditEvent(
      {
        organizationId,
        actorId: ctx.userId,
        action: "project.delete",
        resourceType: "Project",
        resourceId: projectId,
        metadata: { code: project.code },
      },
      tx
    );
  });
}
