import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  getRequestContext,
  movementScopeWhere,
  requireFacilityContext,
  requireOrganizationContext,
  requirePermission,
} from "@/lib/authz/authorize";
import { AppError, errorResponse } from "@/lib/errors";
import { PERMISSIONS } from "@/lib/authz/permissions";
import { toMovementDto } from "@/lib/dto";

interface Params {
  params: Promise<{ movementId: string }>;
}

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    requirePermission(ctx, PERMISSIONS.MOVEMENT_READ);
    const organizationId = requireOrganizationContext(ctx);
    const facilityId = requireFacilityContext(ctx);
    const { movementId } = await params;

    const movement = await prisma.inventoryMovement.findFirst({
      where: { id: movementId, organizationId, ...movementScopeWhere(ctx, facilityId) },
      include: {
        lines: { include: { tool: true, toolUnit: { select: { serialNumber: true } }, sourceLocation: true, destinationLocation: true } },
        actor: { select: { displayName: true } },
        project: { select: { name: true } },
        machine: { select: { name: true } },
        vendor: { select: { name: true } },
        transferFromProject: { select: { name: true } },
        transferToProject: { select: { name: true } },
      },
    });
    if (!movement) throw AppError.notFound("Movement not found.");

    return NextResponse.json({ data: toMovementDto(movement) });
  } catch (error) {
    return errorResponse(error);
  }
}
