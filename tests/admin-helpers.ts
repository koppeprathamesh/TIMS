import { prisma } from "@/lib/db";
import {
  ROLES,
  permissionsForRole,
  type RoleCode,
} from "@/lib/authz/permissions";
import { resolveAccessScope, type RequestContext } from "@/lib/authz/authorize";

export async function createMember(
  organizationId: string,
  email: string,
  opts: { role?: RoleCode; facilityIds?: string[]; departmentIds?: string[] } = {}
) {
  const user = await prisma.user.create({
    data: { email, passwordHash: "x", displayName: email, role: opts.role ?? ROLES.USER },
  });
  await prisma.organizationMembership.create({ data: { organizationId, userId: user.id } });
  for (const facilityId of opts.facilityIds ?? []) {
    await prisma.inventoryAdminFacility.create({ data: { userId: user.id, facilityId } });
  }
  for (const departmentId of opts.departmentIds ?? []) {
    await prisma.userDepartmentAccess.create({ data: { userId: user.id, departmentId } });
  }
  return user;
}

// Builds the same context getRequestContext would, using the real scope resolution.
export async function contextFor(
  base: RequestContext,
  user: { id: string; role: string }
): Promise<RequestContext> {
  const role = user.role as RoleCode;
  const scope = await resolveAccessScope(user.id, role, base.organizationId as string);
  return {
    ...base,
    userId: user.id,
    role,
    permissions: permissionsForRole(role),
    unrestricted: scope.unrestricted,
    grantedFacilityIds: scope.facilityIds,
    grantedDepartmentIds: scope.departmentIds,
    grantedProjectIds: scope.projectIds,
  };
}

let counter = 0;
const next = () => `${Date.now().toString(36)}${counter++}`.toUpperCase();

export function createDepartment(facilityId: string, name = "Dept") {
  return prisma.department.create({ data: { facilityId, name, code: `D-${next()}` } });
}

export function createProject(organizationId: string, departmentId: string | null, name = "Project") {
  return prisma.project.create({ data: { organizationId, departmentId, name, code: `P-${next()}` } });
}

export async function createFacility(organizationId: string, name = "Facility") {
  return prisma.facility.create({ data: { organizationId, name, code: `F-${next()}` } });
}
