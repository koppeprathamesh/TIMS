import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  getRequestContext,
  requireOrganizationContext,
  requireFacilityContext,
  requirePermission,
  requireToolInScope,
} from "@/lib/authz/authorize";
import { AppError, errorResponse } from "@/lib/errors";
import { updateToolSchema } from "@/lib/validation/tools";
import { PERMISSIONS } from "@/lib/authz/permissions";
import { recordAuditEvent } from "@/lib/audit";
import { toToolDetailDto } from "@/lib/dto";

interface Params {
  params: Promise<{ toolId: string }>;
}

async function loadToolDetail(toolId: string, organizationId: string, facilityId: string) {
  const tool = await prisma.tool.findFirstOrThrow({
    where: { id: toolId, organizationId },
    include: {
      defaultLocation: true,
      project: { select: { id: true, name: true, code: true } },
      balances: { where: { facilityId } },
    },
  });
  const sum = (status: string) =>
    tool.balances.filter((b) => b.stockStatus === status).reduce((total, b) => total + b.onHandQuantity, 0);
  return toToolDetailDto(tool, { available: sum("AVAILABLE"), sharpening: sum("SHARPENING"), scrapped: sum("SCRAPPED") });
}

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    requirePermission(ctx, PERMISSIONS.TOOL_READ);
    const organizationId = requireOrganizationContext(ctx);
    const facilityId = requireFacilityContext(ctx);
    const { toolId } = await params;

    // Same visibility rules as the dashboard list: hidden tools are reported as not found.
    await requireToolInScope(ctx, toolId);
    return NextResponse.json({ data: await loadToolDetail(toolId, organizationId, facilityId) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    requirePermission(ctx, PERMISSIONS.TOOL_DELETE);
    const organizationId = requireOrganizationContext(ctx);
    const { toolId } = await params;

    const tool = await requireToolInScope(ctx, toolId);

    // Movement history is the audit trail; a tool that appears in it can only be made inactive.
    if (await prisma.movementLine.count({ where: { toolId } })) {
      throw AppError.conflict("This tool has inventory movement history and cannot be deleted. Set it to Inactive instead.");
    }

    await prisma.$transaction(async (tx) => {
      await tx.inventoryBalance.deleteMany({ where: { toolId } });
      await tx.tool.delete({ where: { id: toolId } });
      await recordAuditEvent(
        {
          organizationId,
          actorId: ctx.userId,
          action: "tool.delete",
          resourceType: "Tool",
          resourceId: toolId,
          metadata: { code: tool.code },
        },
        tx
      );
    });

    return NextResponse.json({ data: { ok: true } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    requirePermission(ctx, PERMISSIONS.TOOL_UPDATE);
    const organizationId = requireOrganizationContext(ctx);
    const facilityId = requireFacilityContext(ctx);
    const { toolId } = await params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw AppError.badRequest("Request body must be valid JSON.");
    }
    const parsed = updateToolSchema.safeParse(body);
    if (!parsed.success) {
      throw AppError.badRequest("Invalid tool data.", parsed.error.flatten());
    }
    const input = parsed.data;

    const existing = await requireToolInScope(ctx, toolId);

    if (input.storageLocationId) {
      const location = await prisma.storageLocation.findFirst({
        where: { id: input.storageLocationId, facilityId },
      });
      if (!location) throw AppError.badRequest("Storage location is not valid for this plant.");
    }

    if (input.code && input.code !== existing.code) {
      const duplicate = await prisma.tool.findUnique({
        where: { organizationId_code: { organizationId, code: input.code } },
      });
      if (duplicate) throw AppError.conflict("A tool with this code already exists.");
    }

    await prisma.$transaction(async (tx) => {
      // The version match is part of the write, so two editors can never both succeed.
      const result = await tx.tool.updateMany({
        where: { id: toolId, version: input.version },
        data: {
          ...(input.code ? { code: input.code } : {}),
          ...(input.name ? { name: input.name } : {}),
          ...(input.drawingNumber !== undefined ? { drawingNumber: input.drawingNumber || null } : {}),
          ...(input.specNumber !== undefined ? { specNumber: input.specNumber || null } : {}),
          ...(input.description !== undefined ? { description: input.description || null } : {}),
          ...(input.minimumQuantity !== undefined ? { minimumQuantity: input.minimumQuantity } : {}),
          ...(input.totalStockCapacity !== undefined ? { totalStockCapacity: input.totalStockCapacity } : {}),
          ...(input.unitOfMeasure ? { unitOfMeasure: input.unitOfMeasure } : {}),
          ...(input.storageLocationId ? { defaultLocationId: input.storageLocationId } : {}),
          ...(input.status ? { status: input.status } : {}),
          updatedById: ctx.userId,
          version: { increment: 1 },
        },
      });
      if (result.count === 0) {
        throw AppError.conflict(
          "This tool was modified by someone else since you loaded it. Please refresh and try again."
        );
      }
      await recordAuditEvent(
        { organizationId, actorId: ctx.userId, action: "tool.update", resourceType: "Tool", resourceId: toolId },
        tx
      );
    });

    return NextResponse.json({ data: await loadToolDetail(toolId, organizationId, facilityId) });
  } catch (error) {
    return errorResponse(error);
  }
}
