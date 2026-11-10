import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { getInventorySummary, getToolIdsByStockFilter } from "@/lib/inventory/stock";
import { toolScopeWhere } from "@/lib/authz/authorize";
import { createFixture, createTool } from "./helpers";
import { createDepartment, createProject } from "./admin-helpers";

type Fixture = Awaited<ReturnType<typeof createFixture>>;

// A project inside the fixture's facility, with the workspace selected on a context.
async function withProject(f: Fixture) {
  const department = await createDepartment(f.facility.id);
  const project = await createProject(f.org.id, department.id);
  await prisma.tool.delete({ where: { id: f.tool.id } });
  const ctx = { ...f.ctx, departmentId: department.id, projectId: project.id };
  return { department, project, ctx };
}

async function setBalance(f: Fixture, toolId: string, stockStatus: string, onHandQuantity: number) {
  await prisma.inventoryBalance.create({
    data: { toolId, facilityId: f.facility.id, locationId: f.locA.id, stockStatus, onHandQuantity },
  });
}

describe("inventory summary", () => {
  it("returns zeros for an empty workspace", async () => {
    const f = await createFixture();
    const { ctx } = await withProject(f);
    expect(await getInventorySummary(ctx)).toEqual({
      toolTypeCount: 0,
      availableStockUnits: 0,
      lowStockToolCount: 0,
      sharpeningUnits: 0,
      scrappedUnits: 0,
      outOfStockToolCount: 0,
    });
  });

  it("classifies healthy, low and out-of-stock tools and counts other statuses", async () => {
    const f = await createFixture();
    const { project, ctx } = await withProject(f);
    const healthy = await createTool(f.org.id, { code: `H-${project.id}`, minimumQuantity: 5, projectId: project.id });
    const low = await createTool(f.org.id, { code: `L-${project.id}`, minimumQuantity: 10, projectId: project.id });
    await createTool(f.org.id, { code: `O-${project.id}`, minimumQuantity: 1, projectId: project.id });

    await setBalance(f, healthy.id, "AVAILABLE", 20);
    await setBalance(f, low.id, "AVAILABLE", 3);
    await setBalance(f, low.id, "SHARPENING", 4);
    await setBalance(f, low.id, "SCRAPPED", 2);

    expect(await getInventorySummary(ctx)).toEqual({
      toolTypeCount: 3,
      availableStockUnits: 23,
      lowStockToolCount: 1,
      sharpeningUnits: 4,
      scrappedUnits: 2,
      outOfStockToolCount: 1,
    });
  });

  it("ignores inactive tools", async () => {
    const f = await createFixture();
    const { project, ctx } = await withProject(f);
    await createTool(f.org.id, { code: `I-${project.id}`, status: "INACTIVE", projectId: project.id });
    expect((await getInventorySummary(ctx)).toolTypeCount).toBe(0);
  });

  it("only counts tools of the selected project", async () => {
    const f = await createFixture();
    const { department, project, ctx } = await withProject(f);
    const otherProject = await createProject(f.org.id, department.id);
    await createTool(f.org.id, { code: `MINE-${project.id}`, projectId: project.id });
    await createTool(f.org.id, { code: `OTHER-${project.id}`, projectId: otherProject.id });

    expect((await getInventorySummary(ctx)).toolTypeCount).toBe(1);
    // Without a project the whole department is counted.
    expect((await getInventorySummary({ ...ctx, projectId: null })).toolTypeCount).toBe(2);
  });

  it("agrees with the tool list scope and the stock-health filter", async () => {
    const f = await createFixture();
    const { project, ctx } = await withProject(f);
    const healthy = await createTool(f.org.id, { code: `H-${project.id}`, minimumQuantity: 5, projectId: project.id });
    const low = await createTool(f.org.id, { code: `L-${project.id}`, minimumQuantity: 10, projectId: project.id });
    const out = await createTool(f.org.id, { code: `O-${project.id}`, minimumQuantity: 2, projectId: project.id });
    await setBalance(f, healthy.id, "AVAILABLE", 9);
    await setBalance(f, low.id, "AVAILABLE", 1);

    const summary = await getInventorySummary(ctx);
    const visible = await prisma.tool.count({ where: { AND: [{ organizationId: f.org.id, status: "ACTIVE" }, toolScopeWhere(ctx, f.facility.id)] } });
    expect(summary.toolTypeCount).toBe(visible);

    expect(await getToolIdsByStockFilter(ctx, f.facility.id, "OK")).toEqual([healthy.id]);
    expect(await getToolIdsByStockFilter(ctx, f.facility.id, "LOW")).toEqual([low.id]);
    expect(await getToolIdsByStockFilter(ctx, f.facility.id, "OUT")).toEqual([out.id]);
    expect((await getToolIdsByStockFilter(ctx, f.facility.id, "LOW")).length).toBe(summary.lowStockToolCount);
    expect((await getToolIdsByStockFilter(ctx, f.facility.id, "OUT")).length).toBe(summary.outOfStockToolCount);
  });
});
