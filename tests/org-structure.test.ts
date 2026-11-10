import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ROLES } from "@/lib/authz/permissions";
import {
  createDepartment as createDepartmentFn,
  createFacility as createFacilityFn,
  createProject as createProjectFn,
  deleteProject,
  listDepartments,
  listFacilities,
  listProjects,
  updateDepartment,
  updateFacility,
  updateProject,
} from "@/lib/admin/org-structure";
import { createMovement } from "@/lib/inventory/engine";
import { createFixture } from "./helpers";
import { contextFor, createDepartment, createFacility, createMember, createProject } from "./admin-helpers";

async function world() {
  const f = await createFixture();
  const otherFacility = await createFacility(f.org.id, "Other");
  const dept = await createDepartment(f.facility.id, "Mine");
  const dept2 = await createDepartment(f.facility.id, "Mine 2");
  const otherDept = await createDepartment(otherFacility.id, "Theirs");
  const admin = await createMember(f.org.id, `ia-${f.org.id}@t.local`, { role: ROLES.INVENTORY_ADMIN, facilityIds: [f.facility.id] });
  const user = await createMember(f.org.id, `u-${f.org.id}@t.local`, { departmentIds: [dept.id] });
  return {
    f,
    otherFacility,
    dept,
    dept2,
    otherDept,
    adminCtx: await contextFor(f.ctx, admin),
    userCtx: await contextFor(f.ctx, user),
    // Scope is recomputed on every real request, so rebuild after creating projects.
    refresh: async () => ({ adminCtx: await contextFor(f.ctx, admin), userCtx: await contextFor(f.ctx, user) }),
  };
}

describe("facilities and departments", () => {
  it("lets only a Super Admin create and edit them, with card presentation fields", async () => {
    const { f, adminCtx, userCtx } = await world();

    const facility = await createFacilityFn(f.ctx, {
      name: "New Plant",
      code: "NEW-1",
      description: "Machining",
      imageUrl: "https://example.com/plant.png",
    });
    expect(facility).toMatchObject({ name: "New Plant", description: "Machining", imageUrl: "https://example.com/plant.png" });
    await expect(createFacilityFn(f.ctx, { name: "Dup", code: "NEW-1" })).rejects.toMatchObject({ status: 409 });

    const department = await createDepartmentFn(f.ctx, {
      facilityId: facility.id,
      name: "Press",
      code: "PRESS",
      description: "Stamping",
    });
    expect(department).toMatchObject({ facilityId: facility.id, description: "Stamping", imageUrl: null });
    await expect(
      createDepartmentFn(f.ctx, { facilityId: facility.id, name: "Dup", code: "PRESS" })
    ).rejects.toMatchObject({ status: 409 });

    await updateFacility(f.ctx, facility.id, { description: null, imageUrl: null });
    await updateDepartment(f.ctx, department.id, { name: "Press Shop" });

    for (const actor of [adminCtx, userCtx]) {
      await expect(createFacilityFn(actor, { name: "X", code: "XX" })).rejects.toMatchObject({ status: 403 });
      await expect(createDepartmentFn(actor, { facilityId: f.facility.id, name: "X", code: "XX" })).rejects.toMatchObject({ status: 403 });
      await expect(updateFacility(actor, f.facility.id, { name: "X" })).rejects.toMatchObject({ status: 403 });
      await expect(updateDepartment(actor, department.id, { name: "X" })).rejects.toMatchObject({ status: 403 });
    }
  });

  it("does not create departments in another organization's facility", async () => {
    const a = await createFixture();
    const b = await createFixture();
    await expect(
      createDepartmentFn(a.ctx, { facilityId: b.facility.id, name: "X", code: "XX" })
    ).rejects.toMatchObject({ status: 404 });
  });

  it("scopes listings to the caller's grants", async () => {
    const { f, otherFacility, dept, dept2, otherDept, adminCtx, userCtx } = await world();

    expect((await listFacilities(f.ctx)).map((x) => x.id).sort()).toEqual([f.facility.id, otherFacility.id].sort());
    expect((await listFacilities(adminCtx)).map((x) => x.id)).toEqual([f.facility.id]);
    expect((await listFacilities(userCtx)).map((x) => x.id)).toEqual([f.facility.id]);

    const adminDepts = (await listDepartments(adminCtx)).map((d) => d.id).sort();
    expect(adminDepts).toEqual([dept.id, dept2.id].sort());
    expect((await listDepartments(userCtx)).map((d) => d.id)).toEqual([dept.id]);
    expect((await listDepartments(f.ctx)).map((d) => d.id)).toContain(otherDept.id);

    await expect(listDepartments(adminCtx, { facilityId: otherFacility.id })).rejects.toMatchObject({ status: 403 });
  });

  it("hides deactivated facilities from everyone except a Super Admin who asks for them", async () => {
    const { f, adminCtx } = await world();
    await updateFacility(f.ctx, f.facility.id, { status: "INACTIVE" });
    expect(await listFacilities(adminCtx, { includeInactive: true })).toHaveLength(0);
    expect((await listFacilities(f.ctx)).map((x) => x.id)).not.toContain(f.facility.id);
    expect((await listFacilities(f.ctx, { includeInactive: true })).map((x) => x.id)).toContain(f.facility.id);
  });
});

describe("projects", () => {
  it("lets an Inventory Admin create, update and delete projects in their departments", async () => {
    const { f, dept, adminCtx, refresh } = await world();

    const project = await createProjectFn(adminCtx, { departmentId: dept.id, name: "Retool", code: "RT-1" });
    expect(project.departmentId).toBe(dept.id);
    await expect(createProjectFn(adminCtx, { departmentId: dept.id, name: "Dup", code: "RT-1" })).rejects.toMatchObject({ status: 409 });

    const fresh = (await refresh()).adminCtx;
    await updateProject(fresh, project.id, { name: "Retool 2", status: "ARCHIVED" });
    expect(await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).toMatchObject({ name: "Retool 2", status: "ARCHIVED" });
    expect(await prisma.auditEvent.count({ where: { organizationId: f.org.id, action: { startsWith: "project." } } })).toBe(2);

    await deleteProject(fresh, project.id);
    expect(await prisma.project.count({ where: { id: project.id } })).toBe(0);
  });

  it("blocks Inventory Admins from projects outside their departments", async () => {
    const { f, otherDept, adminCtx } = await world();
    await expect(
      createProjectFn(adminCtx, { departmentId: otherDept.id, name: "X", code: "XP" })
    ).rejects.toMatchObject({ status: 403 });

    const foreign = await createProject(f.org.id, otherDept.id);
    const orphan = await createProject(f.org.id, null);
    for (const p of [foreign, orphan]) {
      await expect(updateProject(adminCtx, p.id, { name: "x" })).rejects.toMatchObject({ status: 403 });
      await expect(deleteProject(adminCtx, p.id)).rejects.toMatchObject({ status: 403 });
    }
    // A Super Admin can still manage them.
    await updateProject(f.ctx, foreign.id, { name: "ok" });
  });

  it("keeps Users read-only and limited to their departments", async () => {
    const { f, dept, dept2, refresh } = await world();
    const visible = await createProject(f.org.id, dept.id);
    await createProject(f.org.id, dept2.id);
    const { userCtx } = await refresh();

    expect((await listProjects(userCtx)).map((p) => p.id)).toEqual([visible.id]);
    await expect(listProjects(userCtx, { departmentId: dept2.id })).rejects.toMatchObject({ status: 403 });

    await expect(createProjectFn(userCtx, { departmentId: dept.id, name: "X", code: "XU" })).rejects.toMatchObject({ status: 403 });
    await expect(updateProject(userCtx, visible.id, { name: "x" })).rejects.toMatchObject({ status: 403 });
    await expect(deleteProject(userCtx, visible.id)).rejects.toMatchObject({ status: 403 });
  });

  it("refuses to delete a project that has movements, and only shows archived ones to managers", async () => {
    const { f, dept, refresh } = await world();
    const project = await createProject(f.org.id, dept.id);
    const { adminCtx, userCtx } = await refresh();
    await createMovement(f.ctx, {
      facilityId: f.facility.id,
      movementType: "RECEIPT", grnNumber: "GRN1",
      projectId: project.id,
      lines: [{ toolId: f.tool.id, quantity: 1, destinationLocationId: f.locA.id }],
    });

    await expect(deleteProject(adminCtx, project.id)).rejects.toMatchObject({ status: 409 });
    await updateProject(adminCtx, project.id, { status: "ARCHIVED" });

    expect(await listProjects(userCtx, { includeArchived: true })).toHaveLength(0);
    expect((await listProjects(adminCtx, { includeArchived: true })).map((p) => p.id)).toContain(project.id);
  });
});

describe("inventory access by scope", () => {
  it("lets scoped Inventory Admins post only to their facilities", async () => {
    const { f, otherFacility, adminCtx } = await world();
    const locOther = await prisma.storageLocation.create({ data: { facilityId: otherFacility.id, code: "X", name: "X" } });

    await createMovement(adminCtx, {
      facilityId: f.facility.id,
      movementType: "RECEIPT", grnNumber: "GRN1",
      lines: [{ toolId: f.tool.id, quantity: 2, destinationLocationId: f.locA.id }],
    });
    await expect(
      createMovement(adminCtx, {
        facilityId: otherFacility.id,
        movementType: "RECEIPT", grnNumber: "GRN1",
        lines: [{ toolId: f.tool.id, quantity: 2, destinationLocationId: locOther.id }],
      })
    ).rejects.toMatchObject({ status: 403 });
  });

  it("denies Users every write", async () => {
    const { f, userCtx } = await world();
    await expect(
      createMovement(userCtx, {
        facilityId: f.facility.id,
        movementType: "RECEIPT", grnNumber: "GRN1",
        lines: [{ toolId: f.tool.id, quantity: 2, destinationLocationId: f.locA.id }],
      })
    ).rejects.toMatchObject({ status: 403 });
  });

  it("projects only allow access through granted departments when posting", async () => {
    const { f, dept, refresh } = await world();
    const otherProject = await createProject(f.org.id, null);
    const ownProject = await createProject(f.org.id, dept.id);
    const { adminCtx } = await refresh();
    await createMovement(adminCtx, {
      facilityId: f.facility.id,
      movementType: "RECEIPT", grnNumber: "GRN1",
      projectId: ownProject.id,
      lines: [{ toolId: f.tool.id, quantity: 1, destinationLocationId: f.locA.id }],
    });
    await expect(
      createMovement(adminCtx, {
        facilityId: f.facility.id,
        movementType: "RECEIPT", grnNumber: "GRN1",
        projectId: otherProject.id,
        lines: [{ toolId: f.tool.id, quantity: 1, destinationLocationId: f.locA.id }],
      })
    ).rejects.toMatchObject({ status: 403 });
  });
});
