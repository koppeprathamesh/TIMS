import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  type RequestContext,
  projectIdFilter,
  requireFacilityContext,
  requireOrganizationContext,
} from "@/lib/authz/authorize";

// Stock views shared by the dashboard cards, the stock-health filter and the tools API.
export const STOCK_FILTERS = ["OK", "LOW", "OUT", "AVAILABLE", "SHARPENING", "SCRAPPED"] as const;
export type StockFilter = (typeof STOCK_FILTERS)[number];

// The tool scope as ids, so the exact same visibility rules (see toolScopeWhere) can be written
// as plain SQL for aggregation: a selected project, else department, else facility.
export async function resolveToolScopeIds(ctx: RequestContext, facilityId: string) {
  const organizationId = requireOrganizationContext(ctx);
  const allowed = projectIdFilter(ctx);
  const projects = await prisma.project.findMany({
    where: {
      AND: [
        { organizationId, department: { facilityId } },
        ctx.projectId ? { id: ctx.projectId } : {},
        ctx.departmentId ? { departmentId: ctx.departmentId } : {},
        allowed ? { id: allowed } : {},
      ],
    },
    select: { id: true },
  });
  return {
    projectIds: projects.map((p) => p.id),
    // Org-wide tools without a project are only listed at facility level, where they hold stock.
    includeUnassigned: !ctx.projectId && !ctx.departmentId,
  };
}

// One row per active in-scope tool with its stock by status, aggregated in the database.
function scopedToolStock(organizationId: string, facilityId: string, scope: { projectIds: string[]; includeUnassigned: boolean }) {
  const inProjects = scope.projectIds.length
    ? Prisma.sql`t."projectId" IN (${Prisma.join(scope.projectIds)})`
    : Prisma.sql`1 = 0`;
  const unassigned = scope.includeUnassigned
    ? Prisma.sql`OR (t."projectId" IS NULL AND EXISTS (
        SELECT 1 FROM "InventoryBalance" x WHERE x."toolId" = t."id" AND x."facilityId" = ${facilityId}))`
    : Prisma.empty;
  return Prisma.sql`
    SELECT t."id" AS "id", t."minimumQuantity" AS "minimumQuantity",
      COALESCE(SUM(CASE WHEN b."stockStatus" = 'AVAILABLE' THEN b."onHandQuantity" END), 0) AS "available",
      COALESCE(SUM(CASE WHEN b."stockStatus" = 'SHARPENING' THEN b."onHandQuantity" END), 0) AS "sharpening",
      COALESCE(SUM(CASE WHEN b."stockStatus" = 'SCRAPPED' THEN b."onHandQuantity" END), 0) AS "scrapped"
    FROM "Tool" t
    LEFT JOIN "InventoryBalance" b ON b."toolId" = t."id" AND b."facilityId" = ${facilityId}
    WHERE t."organizationId" = ${organizationId} AND t."status" = 'ACTIVE'
      AND (${inProjects} ${unassigned})
    GROUP BY t."id", t."minimumQuantity"`;
}

// Metric definitions (documented in docs/FUNCTIONAL_SPECIFICATION.md):
// - toolTypeCount: distinct ACTIVE in-scope tool master records (not a physical quantity).
// - availableStockUnits: on-hand units in the AVAILABLE status (excludes sharpening/scrap).
// - lowStockToolCount: ACTIVE tools whose available quantity is below minimumQuantity (and > 0).
// - sharpeningUnits / scrappedUnits: on-hand units in those stock statuses.
// - outOfStockToolCount: ACTIVE tools with zero available quantity.
export async function getInventorySummary(ctx: RequestContext, facilityId = requireFacilityContext(ctx)) {
  const organizationId = requireOrganizationContext(ctx);
  const scope = await resolveToolScopeIds(ctx, facilityId);

  const [row] = await prisma.$queryRaw<
    {
      toolTypeCount: bigint | number;
      availableStockUnits: bigint | number;
      lowStockToolCount: bigint | number;
      sharpeningUnits: bigint | number;
      scrappedUnits: bigint | number;
      outOfStockToolCount: bigint | number;
    }[]
  >`
    SELECT
      COUNT(*) AS "toolTypeCount",
      COALESCE(SUM(s."available"), 0) AS "availableStockUnits",
      COALESCE(SUM(CASE WHEN s."available" > 0 AND s."available" < s."minimumQuantity" THEN 1 ELSE 0 END), 0) AS "lowStockToolCount",
      COALESCE(SUM(s."sharpening"), 0) AS "sharpeningUnits",
      COALESCE(SUM(s."scrapped"), 0) AS "scrappedUnits",
      COALESCE(SUM(CASE WHEN s."available" = 0 THEN 1 ELSE 0 END), 0) AS "outOfStockToolCount"
    FROM (${scopedToolStock(organizationId, facilityId, scope)}) s`;

  return {
    toolTypeCount: Number(row.toolTypeCount),
    availableStockUnits: Number(row.availableStockUnits),
    lowStockToolCount: Number(row.lowStockToolCount),
    sharpeningUnits: Number(row.sharpeningUnits),
    scrappedUnits: Number(row.scrappedUnits),
    outOfStockToolCount: Number(row.outOfStockToolCount),
  };
}

const FILTER_PREDICATES: Record<StockFilter, Prisma.Sql> = {
  OK: Prisma.sql`s."available" > 0 AND s."available" >= s."minimumQuantity"`,
  LOW: Prisma.sql`s."available" > 0 AND s."available" < s."minimumQuantity"`,
  OUT: Prisma.sql`s."available" = 0`,
  AVAILABLE: Prisma.sql`s."available" > 0`,
  SHARPENING: Prisma.sql`s."sharpening" > 0`,
  SCRAPPED: Prisma.sql`s."scrapped" > 0`,
};

// Ids of active in-scope tools matching a stock view; the dashboard cards and the stock-health
// filter both resolve through this so card counts and list contents always agree.
export async function getToolIdsByStockFilter(ctx: RequestContext, facilityId: string, filter: StockFilter) {
  const organizationId = requireOrganizationContext(ctx);
  const scope = await resolveToolScopeIds(ctx, facilityId);
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT s."id" AS "id" FROM (${scopedToolStock(organizationId, facilityId, scope)}) s
    WHERE ${FILTER_PREDICATES[filter]}`;
  return rows.map((r) => r.id);
}
