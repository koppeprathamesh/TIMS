import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  getRequestContext,
  movementScopeWhere,
  requireOrganizationContext,
  requireFacilityContext,
  requirePermission,
} from "@/lib/authz/authorize";
import { AppError, errorResponse } from "@/lib/errors";
import { PERMISSIONS } from "@/lib/authz/permissions";
import { createMovementSchema } from "@/lib/validation/movements";
import { dateParam, pageParam, pageSizeParam, toDate } from "@/lib/validation/query";
import { parseQuery } from "@/lib/validation/parse";
import { MOVEMENT_TYPES, createMovement } from "@/lib/inventory/engine";
import { toMovementDto, toMovementReceiptDto } from "@/lib/dto";
import type { Prisma } from "@prisma/client";

const listQuery = z
  .object({
    movementType: z.enum([...MOVEMENT_TYPES, "REVERSAL"]).optional(),
    status: z.enum(["POSTED", "PENDING_APPROVAL", "CANCELLED", "REVERSED"]).optional(),
    toolId: z.string().max(64).optional(),
    projectId: z.string().max(64).optional(),
    actorId: z.string().max(64).optional(),
    dateFrom: dateParam.optional(),
    dateTo: dateParam.optional(),
    page: pageParam,
    pageSize: pageSizeParam(25),
  })
  .refine((q) => !q.dateFrom || !q.dateTo || toDate(q.dateFrom, false) <= toDate(q.dateTo, true), {
    message: "dateFrom must not be after dateTo.",
    path: ["dateFrom"],
  });

export async function GET(request: NextRequest) {
  try {
    const ctx = await getRequestContext();
    requirePermission(ctx, PERMISSIONS.MOVEMENT_READ);
    const organizationId = requireOrganizationContext(ctx);
    const facilityId = requireFacilityContext(ctx);
    const q = parseQuery(request, listQuery);

    const where: Prisma.InventoryMovementWhereInput = {
      AND: [
        { organizationId },
        movementScopeWhere(ctx, facilityId),
        q.movementType ? { movementType: q.movementType } : {},
        q.status ? { status: q.status } : {},
        q.projectId ? { projectId: q.projectId } : {},
        q.actorId ? { actorId: q.actorId } : {},
        q.toolId ? { lines: { some: { toolId: q.toolId } } } : {},
        q.dateFrom || q.dateTo
          ? {
              occurredAt: {
                ...(q.dateFrom ? { gte: toDate(q.dateFrom, false) } : {}),
                ...(q.dateTo ? { lte: toDate(q.dateTo, true) } : {}),
              },
            }
          : {},
      ],
    };

    const [total, movements] = await Promise.all([
      prisma.inventoryMovement.count({ where }),
      prisma.inventoryMovement.findMany({
        where,
        include: {
          lines: { include: { tool: true, toolUnit: { select: { serialNumber: true } }, sourceLocation: true, destinationLocation: true } },
          actor: { select: { displayName: true } },
          project: { select: { name: true } },
          machine: { select: { name: true } },
          vendor: { select: { name: true } },
          transferFromProject: { select: { name: true } },
          transferToProject: { select: { name: true } },
        },
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);

    return NextResponse.json({
      data: movements.map(toMovementDto),
      pagination: { page: q.page, pageSize: q.pageSize, total, totalPages: Math.ceil(total / q.pageSize) },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getRequestContext();
    const facilityId = requireFacilityContext(ctx);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw AppError.badRequest("Request body must be valid JSON.");
    }
    const parsed = createMovementSchema.safeParse(body);
    if (!parsed.success) {
      throw AppError.badRequest("Invalid movement request.", parsed.error.flatten());
    }
    const input = parsed.data;

    const movement = await createMovement(ctx, {
      facilityId,
      movementType: input.movementType,
      lines: input.lines,
      projectId: input.projectId,
      machineId: input.machineId,
      vendorId: input.vendorId,
      reason: input.reason,
      remarks: input.remarks,
      challanNumber: input.challanNumber,
      grnNumber: input.grnNumber,
      transferToProjectId: input.transferToProjectId,
      idempotencyKey: input.idempotencyKey,
    });

    return NextResponse.json({ data: toMovementReceiptDto(movement) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
