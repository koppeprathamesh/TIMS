import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/auth/password";
import { ROLES } from "../src/lib/authz/permissions";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding development data (idempotent)...");

  const organization = await prisma.organization.upsert({
    where: { code: "ACME" },
    update: {},
    create: { name: "Acme Manufacturing", code: "ACME" },
  });

  const facility = await prisma.facility.upsert({
    where: { organizationId_code: { organizationId: organization.id, code: "MX107-B4" } },
    update: {},
    create: {
      organizationId: organization.id,
      name: "MX107-B4 Plant",
      code: "MX107-B4",
      description: "Primary machining plant with the central tool crib.",
    },
  });

  // A second facility that the seeded Inventory Admin and User are deliberately NOT granted.
  const otherFacility = await prisma.facility.upsert({
    where: { organizationId_code: { organizationId: organization.id, code: "MX200-A1" } },
    update: {},
    create: {
      organizationId: organization.id,
      name: "MX200-A1 Assembly",
      code: "MX200-A1",
      description: "Final assembly and test facility.",
    },
  });

  const department = await prisma.department.upsert({
    where: { facilityId_code: { facilityId: facility.id, code: "TOOLROOM" } },
    update: {},
    create: {
      facilityId: facility.id,
      name: "Tool Room",
      code: "TOOLROOM",
      description: "Tool storage, sharpening and issue.",
    },
  });

  await prisma.department.upsert({
    where: { facilityId_code: { facilityId: otherFacility.id, code: "ASSEMBLY" } },
    update: {},
    create: {
      facilityId: otherFacility.id,
      name: "Assembly",
      code: "ASSEMBLY",
      description: "Line assembly cells.",
    },
  });

  const project = await prisma.project.upsert({
    where: { organizationId_code: { organizationId: organization.id, code: "PRJ-001" } },
    update: {},
    create: {
      organizationId: organization.id,
      departmentId: department.id,
      name: "Line 1 Retooling",
      code: "PRJ-001",
    },
  });

  const locationA = await prisma.storageLocation.upsert({
    where: { facilityId_code: { facilityId: facility.id, code: "RACK-A1" } },
    update: {},
    create: { facilityId: facility.id, code: "RACK-A1", name: "Rack A1 — Tool Crib" },
  });
  const locationB = await prisma.storageLocation.upsert({
    where: { facilityId_code: { facilityId: facility.id, code: "RACK-B2" } },
    update: {},
    create: { facilityId: facility.id, code: "RACK-B2", name: "Rack B2 — Tool Crib" },
  });

  const machine = await prisma.machine.upsert({
    where: { facilityId_code: { facilityId: facility.id, code: "CNC-01" } },
    update: {},
    create: { facilityId: facility.id, code: "CNC-01", name: "CNC Mill 01" },
  });

  // Users: one per role. Role and access grants are re-applied on every run.
  const passwordHash = await hashPassword("Password123!");
  const seedUser = (email: string, displayName: string, role: string) =>
    prisma.user.upsert({
      where: { email },
      update: { role },
      create: { email, displayName, passwordHash, role },
    });

  const admin = await seedUser("admin@etgroupindia.com", "Alex Admin", ROLES.SUPER_ADMIN);
  const inventoryAdmin = await seedUser("inventory.admin@etgroupindia.com", "Ines Inventory", ROLES.INVENTORY_ADMIN);
  const viewer = await seedUser("user@etgroupindia.com", "Sam User", ROLES.USER);

  for (const user of [admin, inventoryAdmin, viewer]) {
    await prisma.organizationMembership.upsert({
      where: { organizationId_userId: { organizationId: organization.id, userId: user.id } },
      update: {},
      create: { organizationId: organization.id, userId: user.id },
    });
  }

  await prisma.inventoryAdminFacility.deleteMany({ where: { userId: inventoryAdmin.id } });
  await prisma.inventoryAdminFacility.create({
    data: { userId: inventoryAdmin.id, facilityId: facility.id, grantedById: admin.id },
  });
  await prisma.userDepartmentAccess.deleteMany({ where: { userId: viewer.id } });
  await prisma.userDepartmentAccess.create({
    data: { userId: viewer.id, departmentId: department.id, grantedById: inventoryAdmin.id },
  });

  // Tool master data
  const toolSeed = [
    { code: "TL-1001", name: "12mm Carbide End Mill", min: 5, cap: 50, loc: locationA.id },
    { code: "TL-1002", name: "Precision Dial Indicator", min: 2, cap: 10, loc: locationA.id },
    { code: "TL-1003", name: "25mm Twist Drill Bit", min: 10, cap: 100, loc: locationB.id },
  ];

  const tools = [];
  for (const t of toolSeed) {
    const tool = await prisma.tool.upsert({
      where: { organizationId_code: { organizationId: organization.id, code: t.code } },
      update: { projectId: project.id },
      create: {
        organizationId: organization.id,
        projectId: project.id,
        code: t.code,
        name: t.name,
        minimumQuantity: t.min,
        totalStockCapacity: t.cap,
        defaultLocationId: t.loc,
        createdById: admin.id,
        updatedById: admin.id,
      },
    });
    tools.push({ tool, locationId: t.loc });
  }

  // Opening balances via explicit RECEIPT movements (never a direct balance write).
  for (const { tool, locationId } of tools) {
    const existingBalance = await prisma.inventoryBalance.findUnique({
      where: {
        toolId_locationId_stockStatus: {
          toolId: tool.id,
          locationId,
          stockStatus: "AVAILABLE",
        },
      },
    });
    if (existingBalance) continue;

    await prisma.$transaction(async (tx) => {
      const balance = await tx.inventoryBalance.create({
        data: {
          toolId: tool.id,
          facilityId: facility.id,
          locationId,
          stockStatus: "AVAILABLE",
          onHandQuantity: tool.totalStockCapacity,
        },
      });
      await tx.inventoryMovement.create({
        data: {
          organizationId: organization.id,
          facilityId: facility.id,
          movementNumber: `SEED-${tool.code}`,
          movementType: "RECEIPT",
          status: "POSTED",
          actorId: admin.id,
          reason: "Opening balance (seed data)",
          postedAt: new Date(),
          lines: {
            create: [
              {
                toolId: tool.id,
                quantity: balance.onHandQuantity,
                destinationLocationId: locationId,
              },
            ],
          },
        },
      });
    });
  }

  console.log("Seed complete. All passwords: Password123!");
  console.log("  admin@etgroupindia.com            Super Admin");
  console.log("  inventory.admin@etgroupindia.com  Inventory Admin (facility MX107-B4)");
  console.log("  user@etgroupindia.com             User (department TOOLROOM)");
  console.log({ facility: facility.code, project: project.code, machine: machine.code });
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
