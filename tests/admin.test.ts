import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { PERMISSIONS, ROLES } from "@/lib/authz/permissions";
import { createUser, listUsers, setUserAccess, updateUser } from "@/lib/admin/users";
import { getSettings, updateOrganization } from "@/lib/admin/settings";
import { createMovement } from "@/lib/inventory/engine";
import { listNotifications, markAllNotificationsRead, markNotificationRead } from "@/lib/admin/notifications";
import { createUserSchema } from "@/lib/validation/admin";
import { createFixture } from "./helpers";
import { contextFor, createDepartment, createFacility, createMember } from "./admin-helpers";

const PASSWORD = "Sup3rSecret99";

describe("create user schema", () => {
  const base = { email: "a@etgroupindia.com", displayName: "A", password: PASSWORD };

  it("only accepts the creatable roles", () => {
    expect(createUserSchema.safeParse({ ...base, role: "SUPER_ADMIN", departmentIds: ["d"] }).success).toBe(false);
    expect(createUserSchema.safeParse({ ...base, role: "ORG_ADMIN", departmentIds: ["d"] }).success).toBe(false);
  });

  it("requires facilities for Inventory Admins and departments for Users", () => {
    expect(createUserSchema.safeParse({ ...base, role: "INVENTORY_ADMIN" }).success).toBe(false);
    expect(createUserSchema.safeParse({ ...base, role: "INVENTORY_ADMIN", facilityIds: ["f"] }).success).toBe(true);
    expect(createUserSchema.safeParse({ ...base, role: "USER" }).success).toBe(false);
    expect(createUserSchema.safeParse({ ...base, role: "USER", departmentIds: ["d"] }).success).toBe(true);
  });
});

describe("super admin user management", () => {
  it("creates an Inventory Admin with facility grants, hashed password, membership and audit", async () => {
    const f = await createFixture();
    const email = `ia-${f.org.id}@test.local`;

    const created = await createUser(f.ctx, {
      email,
      displayName: "Inventory Admin",
      password: PASSWORD,
      role: ROLES.INVENTORY_ADMIN,
      facilityIds: [f.facility.id],
    });

    const row = await prisma.user.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.role).toBe(ROLES.INVENTORY_ADMIN);
    expect(row.passwordHash).not.toContain(PASSWORD);
    expect(await prisma.organizationMembership.count({ where: { userId: created.id, organizationId: f.org.id } })).toBe(1);
    expect(await prisma.inventoryAdminFacility.count({ where: { userId: created.id, facilityId: f.facility.id, grantedById: f.user.id } })).toBe(1);
    expect(await prisma.auditEvent.count({ where: { organizationId: f.org.id, action: "user.create" } })).toBe(1);

    await expect(
      createUser(f.ctx, { email, displayName: "Dup", password: PASSWORD, role: ROLES.INVENTORY_ADMIN, facilityIds: [f.facility.id] })
    ).rejects.toMatchObject({ status: 409 });
  });

  it("creates a User with department access", async () => {
    const f = await createFixture();
    const dept = await createDepartment(f.facility.id);
    const created = await createUser(f.ctx, {
      email: `u-${f.org.id}@test.local`,
      displayName: "Viewer",
      password: PASSWORD,
      role: ROLES.USER,
      departmentIds: [dept.id],
    });
    expect(await prisma.userDepartmentAccess.count({ where: { userId: created.id, departmentId: dept.id } })).toBe(1);
  });

  it("rejects facilities and departments from another organization", async () => {
    const a = await createFixture();
    const b = await createFixture();
    const foreignDept = await createDepartment(b.facility.id);
    await expect(
      createUser(a.ctx, { email: `x1-${a.org.id}@t.local`, displayName: "X", password: PASSWORD, role: ROLES.INVENTORY_ADMIN, facilityIds: [b.facility.id] })
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      createUser(a.ctx, { email: `x2-${a.org.id}@t.local`, displayName: "X", password: PASSWORD, role: ROLES.USER, departmentIds: [foreignDept.id] })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("requires user.manage", async () => {
    const f = await createFixture({ permissions: [PERMISSIONS.USER_READ] });
    await expect(
      createUser(f.ctx, { email: `x-${f.org.id}@t.local`, displayName: "X", password: PASSWORD, role: ROLES.USER, departmentIds: ["d"] })
    ).rejects.toMatchObject({ status: 403 });
  });

  it("lists only members of the caller's organization, without secrets", async () => {
    const a = await createFixture();
    const b = await createFixture();
    await createMember(a.org.id, `member-${a.org.id}@t.local`);
    const users = await listUsers(a.ctx);
    const emails = users.map((u) => u.email);
    expect(emails).toContain(`member-${a.org.id}@t.local`);
    expect(emails).toContain(a.user.email);
    expect(emails).not.toContain(b.user.email);
    expect(JSON.stringify(users)).not.toContain("passwordHash");
  });

  it("updates, deactivates and resets passwords, but never self-deactivates", async () => {
    const f = await createFixture();
    const target = await createMember(f.org.id, `t-${f.org.id}@t.local`);

    await updateUser(f.ctx, target.id, { displayName: "Renamed", status: "INACTIVE" });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).toMatchObject({
      displayName: "Renamed",
      status: "INACTIVE",
    });

    const before = (await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).passwordHash;
    await updateUser(f.ctx, target.id, { password: "An0therSecret!" });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).passwordHash).not.toBe(before);
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: "user.password_reset", resourceId: target.id } });
    expect(audit.metadata).not.toContain("An0therSecret");

    await expect(updateUser(f.ctx, f.user.id, { status: "INACTIVE" })).rejects.toMatchObject({ status: 409 });
  });

  it("rejects users from another organization", async () => {
    const a = await createFixture();
    const b = await createFixture();
    await expect(updateUser(a.ctx, b.user.id, { displayName: "Hax" })).rejects.toMatchObject({ status: 404 });
  });

  it("replaces an Inventory Admin's facilities and forbids changing your own access", async () => {
    const f = await createFixture();
    const second = await createFacility(f.org.id);
    const ia = await createMember(f.org.id, `ia2-${f.org.id}@t.local`, { role: ROLES.INVENTORY_ADMIN, facilityIds: [f.facility.id] });

    await setUserAccess(f.ctx, ia.id, { facilityIds: [second.id] });
    const grants = await prisma.inventoryAdminFacility.findMany({ where: { userId: ia.id } });
    expect(grants.map((g) => g.facilityId)).toEqual([second.id]);

    await expect(setUserAccess(f.ctx, ia.id, { facilityIds: [] })).rejects.toMatchObject({ status: 400 });
    await expect(setUserAccess(f.ctx, f.user.id, { facilityIds: [second.id] })).rejects.toMatchObject({ status: 409 });
  });
});

describe("inventory admin user management", () => {
  async function setup() {
    const f = await createFixture();
    const otherFacility = await createFacility(f.org.id);
    const dept = await createDepartment(f.facility.id);
    const dept2 = await createDepartment(f.facility.id);
    const otherDept = await createDepartment(otherFacility.id);
    const admin = await createMember(f.org.id, `admin-${f.org.id}@t.local`, {
      role: ROLES.INVENTORY_ADMIN,
      facilityIds: [f.facility.id],
    });
    const adminCtx = await contextFor(f.ctx, admin);
    return { f, otherFacility, dept, dept2, otherDept, admin, adminCtx };
  }

  it("creates Users only inside their facilities", async () => {
    const { f, dept, otherDept, admin, adminCtx } = await setup();
    const created = await createUser(adminCtx, {
      email: `new-${f.org.id}@t.local`,
      displayName: "N",
      password: PASSWORD,
      role: ROLES.USER,
      departmentIds: [dept.id],
    });
    expect(await prisma.userDepartmentAccess.findFirstOrThrow({ where: { userId: created.id } })).toMatchObject({
      departmentId: dept.id,
      grantedById: admin.id,
    });

    await expect(
      createUser(adminCtx, { email: `out-${f.org.id}@t.local`, displayName: "O", password: PASSWORD, role: ROLES.USER, departmentIds: [otherDept.id] })
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      createUser(adminCtx, { email: `mix-${f.org.id}@t.local`, displayName: "M", password: PASSWORD, role: ROLES.USER, departmentIds: [dept.id, otherDept.id] })
    ).rejects.toMatchObject({ status: 403 });
    expect(await prisma.user.count({ where: { email: { in: [`out-${f.org.id}@t.local`, `mix-${f.org.id}@t.local`] } } })).toBe(0);
  });

  it("cannot create Inventory Admins", async () => {
    const { f, adminCtx } = await setup();
    await expect(
      createUser(adminCtx, { email: `ia3-${f.org.id}@t.local`, displayName: "I", password: PASSWORD, role: ROLES.INVENTORY_ADMIN, facilityIds: [f.facility.id] })
    ).rejects.toMatchObject({ status: 403 });
  });

  it("only lists and manages Users within their scope", async () => {
    const { f, dept, otherDept, adminCtx, admin } = await setup();
    const inScope = await createMember(f.org.id, `in-${f.org.id}@t.local`, { departmentIds: [dept.id] });
    const outOfScope = await createMember(f.org.id, `out-${f.org.id}@t.local`, { departmentIds: [otherDept.id] });
    const peerAdmin = await createMember(f.org.id, `peer-${f.org.id}@t.local`, { role: ROLES.INVENTORY_ADMIN, facilityIds: [f.facility.id] });

    const listed = (await listUsers(adminCtx)).map((u) => u.id);
    expect(listed).toContain(inScope.id);
    expect(listed).not.toContain(outOfScope.id);
    expect(listed).not.toContain(peerAdmin.id);
    expect(listed).not.toContain(admin.id);

    await updateUser(adminCtx, inScope.id, { displayName: "Renamed" });
    await expect(updateUser(adminCtx, outOfScope.id, { displayName: "x" })).rejects.toMatchObject({ status: 403 });
    await expect(updateUser(adminCtx, peerAdmin.id, { password: "An0therSecret!" })).rejects.toMatchObject({ status: 403 });
    await expect(updateUser(adminCtx, f.user.id, { password: "An0therSecret!" })).rejects.toMatchObject({ status: 403 });
  });

  it("changes department access without touching grants from outside their scope", async () => {
    const { f, dept, dept2, otherDept, adminCtx } = await setup();
    const target = await createMember(f.org.id, `t-${f.org.id}@t.local`, { departmentIds: [dept.id, otherDept.id] });

    await setUserAccess(adminCtx, target.id, { departmentIds: [dept2.id] });
    const granted = (await prisma.userDepartmentAccess.findMany({ where: { userId: target.id } })).map((a) => a.departmentId).sort();
    expect(granted).toEqual([dept2.id, otherDept.id].sort());

    await expect(setUserAccess(adminCtx, target.id, { departmentIds: [otherDept.id] })).rejects.toMatchObject({ status: 403 });
    await expect(setUserAccess(adminCtx, target.id, { facilityIds: [f.facility.id] })).rejects.toMatchObject({ status: 400 });
  });

  it("cannot change facility grants of an Inventory Admin", async () => {
    const { f, adminCtx } = await setup();
    const peer = await createMember(f.org.id, `peer2-${f.org.id}@t.local`, { role: ROLES.INVENTORY_ADMIN, facilityIds: [f.facility.id] });
    await expect(setUserAccess(adminCtx, peer.id, { facilityIds: [f.facility.id] })).rejects.toMatchObject({ status: 403 });
  });
});

describe("settings", () => {
  it("reads and updates the organization with audit", async () => {
    const f = await createFixture();
    await updateOrganization(f.ctx, { name: "Renamed Org" });
    expect((await getSettings(f.ctx)).organization.name).toBe("Renamed Org");
    expect(await prisma.auditEvent.count({ where: { organizationId: f.org.id, action: "settings.organization_update" } })).toBe(1);
  });

  it("requires settings.manage", async () => {
    const f = await createFixture({ permissions: [PERMISSIONS.SETTINGS_READ] });
    await expect(updateOrganization(f.ctx, { name: "x" })).rejects.toMatchObject({ status: 403 });
  });
});

describe("notifications", () => {
  it("alerts users with access to the facility once and never duplicates unread alerts", async () => {
    const f = await createFixture();
    const dept = await createDepartment(f.facility.id);
    const otherFacility = await createFacility(f.org.id);
    const otherDept = await createDepartment(otherFacility.id);
    const viewer = await createMember(f.org.id, `v-${f.org.id}@t.local`, { departmentIds: [dept.id] });
    const outsider = await createMember(f.org.id, `o-${f.org.id}@t.local`, { departmentIds: [otherDept.id] });
    const noAccess = await createMember(f.org.id, `n-${f.org.id}@t.local`);

    // f.tool minimum is 5: receiving 3 leaves it low.
    const receive = (qty: number) =>
      createMovement(f.ctx, {
        facilityId: f.facility.id,
        movementType: "RECEIPT", grnNumber: "GRN1",
        lines: [{ toolId: f.tool.id, quantity: qty, destinationLocationId: f.locA.id }],
      });
    await receive(3);
    await receive(1);

    const viewerCtx = { ...f.ctx, userId: viewer.id };
    const { items, unreadCount } = await listNotifications(viewerCtx);
    expect(items).toHaveLength(1);
    expect(unreadCount).toBe(1);
    expect(items[0]).toMatchObject({ type: "LOW_STOCK", title: `Low stock: ${f.tool.code}` });

    expect((await listNotifications({ ...f.ctx, userId: outsider.id })).items).toHaveLength(0);
    expect((await listNotifications({ ...f.ctx, userId: noAccess.id })).items).toHaveLength(0);

    await receive(10);
    expect((await listNotifications(viewerCtx)).items).toHaveLength(1);
  });

  it("marks notifications read only for their owner", async () => {
    const f = await createFixture();
    const other = await createMember(f.org.id, `n-${f.org.id}@t.local`);
    const mine = await prisma.notification.create({ data: { userId: f.user.id, type: "T", title: "a", message: "a" } });
    const theirs = await prisma.notification.create({ data: { userId: other.id, type: "T", title: "b", message: "b" } });
    await prisma.notification.create({ data: { userId: f.user.id, type: "T", title: "c", message: "c" } });

    await expect(markNotificationRead(f.ctx, theirs.id)).rejects.toMatchObject({ status: 404 });
    await markNotificationRead(f.ctx, mine.id);
    expect((await listNotifications(f.ctx)).unreadCount).toBe(1);

    expect(await markAllNotificationsRead(f.ctx)).toBe(1);
    expect((await listNotifications(f.ctx)).unreadCount).toBe(0);
    expect((await listNotifications({ ...f.ctx, userId: other.id })).unreadCount).toBe(1);
  });
});
