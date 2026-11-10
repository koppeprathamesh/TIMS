import { prisma } from "@/lib/db";
import { ALL_PERMISSION_CODES, ROLES } from "@/lib/authz/permissions";
import type { RequestContext } from "@/lib/authz/authorize";

let counter = 0;
const uid = () => `${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// Every test gets its own organization so tests never share stock.
// The caller is an unrestricted Super Admin unless `grantedFacilityIds` scopes them down.
export async function createFixture(opts: { permissions?: string[]; grantedFacilityIds?: string[] } = {}) {
  const key = uid();
  const org = await prisma.organization.create({ data: { name: `Org ${key}`, code: `ORG-${key}` } });
  const facility = await prisma.facility.create({
    data: { organizationId: org.id, name: `Facility ${key}`, code: `F-${key}` },
  });
  const user = await prisma.user.create({
    data: { email: `${key}@test.local`, passwordHash: "x", displayName: `User ${key}`, role: ROLES.SUPER_ADMIN },
  });
  await prisma.organizationMembership.create({ data: { organizationId: org.id, userId: user.id } });
  const locA = await prisma.storageLocation.create({
    data: { facilityId: facility.id, code: "A", name: "Location A" },
  });
  const locB = await prisma.storageLocation.create({
    data: { facilityId: facility.id, code: "B", name: "Location B" },
  });
  const tool = await createTool(org.id, { code: `T-${key}`, minimumQuantity: 5 });

  const ctx: RequestContext = {
    userId: user.id,
    organizationId: org.id,
    facilityId: facility.id,
    departmentId: null,
    projectId: null,
    permissions: new Set<string>(opts.permissions ?? ALL_PERMISSION_CODES),
    role: opts.grantedFacilityIds ? ROLES.INVENTORY_ADMIN : ROLES.SUPER_ADMIN,
    unrestricted: !opts.grantedFacilityIds,
    grantedFacilityIds: new Set<string>(opts.grantedFacilityIds ?? []),
    grantedDepartmentIds: new Set<string>(),
    grantedProjectIds: new Set<string>(),
  };

  return { org, facility, user, locA, locB, tool, ctx };
}

export function createTool(
  organizationId: string,
  data: { code: string; minimumQuantity?: number; status?: string; projectId?: string | null }
) {
  return prisma.tool.create({
    data: {
      organizationId,
      projectId: data.projectId ?? null,
      code: data.code,
      name: `Tool ${data.code}`,
      minimumQuantity: data.minimumQuantity ?? 0,
      status: data.status ?? "ACTIVE",
    },
  });
}

export async function onHand(toolId: string, locationId: string, stockStatus = "AVAILABLE") {
  const row = await prisma.inventoryBalance.findUnique({
    where: { toolId_locationId_stockStatus: { toolId, locationId, stockStatus } },
  });
  return row?.onHandQuantity ?? 0;
}
