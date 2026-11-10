import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  getRequestContext,
  requireOrganizationContext,
  requireFacilityContext,
  requirePermission,
  assertProjectAccess,
  toolScopeWhere,
} from "@/lib/authz/authorize";
import { AppError, errorResponse } from "@/lib/errors";
import { createToolSchema } from "@/lib/validation/tools";
import { pageParam, pageSizeParam, sortDirParam } from "@/lib/validation/query";
import { parseQuery } from "@/lib/validation/parse";
import { PERMISSIONS } from "@/lib/authz/permissions";
import { recordAuditEvent } from "@/lib/audit";
import { STOCK_FILTERS, getToolIdsByStockFilter } from "@/lib/inventory/stock";
import { toToolSummaryDto } from "@/lib/dto";

// Only these columns may be sorted on; anything else is rejected rather than passed to the ORM.
const SORTABLE = ["name", "code", "minimumQuantity", "updatedAt"] as const;

const listQuery = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  stock: z.enum(["ALL", ...STOCK_FILTERS]).optional(),
  locationId: z.string().max(64).optional(),
  projectId: z.string().max(64).optional(),
  page: pageParam,
  pageSize: pageSizeParam(25),
  sortBy: z.enum(SORTABLE).default("name"),
  sortDir: sortDirParam,
});

export async function GET(request: NextRequest) {
  try {
    const ctx = await getRequestContext();
    requirePermission(ctx, PERMISSIONS.TOOL_READ);
    const organizationId = requireOrganizationContext(ctx);
    const facilityId = requireFacilityContext(ctx);
    const q = parseQuery(request, listQuery);

    // An explicit project narrows the workspace scope; it can never widen it.
    if (q.projectId) assertProjectAccess(ctx, q.projectId);
    const stockToolIds =
      q.stock && q.stock !== "ALL" ? await getToolIdsByStockFilter(ctx, facilityId, q.stock) : null;

    const where: Prisma.ToolWhereInput = {
      AND: [
        { organizationId },
        toolScopeWhere(ctx, facilityId),
        q.projectId ? { projectId: q.projectId } : {},
        q.status ? { status: q.status } : {},
        q.locationId ? { defaultLocationId: q.locationId } : {},
        stockToolIds ? { id: { in: stockToolIds } } : {},
        q.search
          ? {
              OR: [
                { code: { contains: q.search } },
                { name: { contains: q.search } },
                { drawingNumber: { contains: q.search } },
                { specNumber: { contains: q.search } },
              ],
            }
          : {},
      ],
    };

    const [total, tools] = await Promise.all([
      prisma.tool.count({ where }),
      prisma.tool.findMany({
        where,
        include: {
          defaultLocation: true,
          project: { select: { id: true, name: true, code: true } },
          balances: { where: { facilityId, stockStatus: "AVAILABLE" } },
        },
        orderBy: [{ [q.sortBy]: q.sortDir }, { id: "asc" }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);

    const data = tools.map((tool) => {
      const available = tool.balances.reduce((sum, b) => sum + b.onHandQuantity, 0);
      const toolStatus =
        available === 0 ? "OUT_OF_STOCK" : available < tool.minimumQuantity ? "LOW_STOCK" : "OK";
      return {
        id: tool.id,
        code: tool.code,
        name: tool.name,
        drawingNumber: tool.drawingNumber,
        specNumber: tool.specNumber,
        minimumQuantity: tool.minimumQuantity,
        totalStockCapacity: tool.totalStockCapacity,
        availableQuantity: available,
        location: tool.defaultLocation ? tool.defaultLocation.name : null,
        locationId: tool.defaultLocationId,
        project: tool.project,
        status: tool.status,
        stockStatus: toolStatus,
        version: tool.version,
      };
    });

    return NextResponse.json({
      data,
      pagination: { page: q.page, pageSize: q.pageSize, total, totalPages: Math.ceil(total / q.pageSize) },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getRequestContext();
    requirePermission(ctx, PERMISSIONS.TOOL_CREATE);
    const organizationId = requireOrganizationContext(ctx);
    const facilityId = requireFacilityContext(ctx);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw AppError.badRequest("Request body must be valid JSON.");
    }
    const parsed = createToolSchema.safeParse(body);
    if (!parsed.success) {
      throw AppError.badRequest("Invalid tool data.", parsed.error.flatten());
    }
    const input = parsed.data;

    // Resolve the owning project: explicit input wins, otherwise the active
    // project context. The caller must be authorized for whichever is used.
    const projectId = input.projectId ?? ctx.projectId ?? null;
    if (!projectId) {
      throw AppError.badRequest("Select a part before adding tools.");
    }
    assertProjectAccess(ctx, projectId);
    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId, department: { facilityId } },
      select: { id: true },
    });
    if (!project) throw AppError.badRequest("Part is not valid for the selected plant.");

    const location = await prisma.storageLocation.findFirst({
      where: { id: input.storageLocationId, facilityId },
    });
    if (!location) throw AppError.badRequest("Storage location is not valid for this plant.");

    const duplicate = await prisma.tool.findUnique({
      where: { organizationId_code: { organizationId, code: input.code } },
    });
    if (duplicate) throw AppError.conflict("A tool with this code already exists.");

    let tool;
    try {
      tool = await prisma.$transaction(async (tx) => {
        const created = await tx.tool.create({
          data: {
            organizationId,
            projectId,
            code: input.code,
            name: input.name,
            drawingNumber: input.drawingNumber || null,
            specNumber: input.specNumber || null,
            description: input.description || null,
            minimumQuantity: input.minimumQuantity,
            totalStockCapacity: input.totalStockCapacity,
            unitOfMeasure: input.unitOfMeasure,
            defaultLocationId: input.storageLocationId,
            status: input.status,
            createdById: ctx.userId,
            updatedById: ctx.userId,
          },
        });
        await recordAuditEvent(
          {
            organizationId,
            actorId: ctx.userId,
            action: "tool.create",
            resourceType: "Tool",
            resourceId: created.id,
            metadata: { code: created.code, projectId },
          },
          tx
        );
        return created;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw AppError.conflict("A tool with this code already exists.");
      }
      throw error;
    }

    return NextResponse.json({ data: toToolSummaryDto(tool) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
