import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  facilityIdFilter,
  getRequestContext,
  requirePermission,
  requireToolInScope,
} from "@/lib/authz/authorize";
import { errorResponse } from "@/lib/errors";
import { PERMISSIONS } from "@/lib/authz/permissions";
import { pageParam } from "@/lib/validation/query";
import { parseQuery } from "@/lib/validation/parse";

interface Params {
  params: Promise<{ toolId: string }>;
}

const PAGE_SIZE = 25;
const query = z.object({ page: pageParam });

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    requirePermission(ctx, PERMISSIONS.MOVEMENT_READ);
    const { toolId } = await params;
    const { page } = parseQuery(request, query);

    await requireToolInScope(ctx, toolId, { includeUnassigned: true });

    const where = { toolId, movement: { facilityId: facilityIdFilter(ctx) } };
    const [total, lines] = await Promise.all([
      prisma.movementLine.count({ where }),
      prisma.movementLine.findMany({
        where,
        include: {
          movement: {
            select: {
              movementNumber: true,
              movementType: true,
              status: true,
              challanNumber: true,
              grnNumber: true,
              remarks: true,
              reason: true,
              machine: { select: { name: true } },
              vendor: { select: { name: true } },
              transferFromProject: { select: { name: true } },
              transferToProject: { select: { name: true } },
              actor: { select: { displayName: true } },
            },
          },
          sourceLocation: { select: { name: true } },
          destinationLocation: { select: { name: true } },
          toolUnit: { select: { serialNumber: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
    ]);

    const data = lines.map((line) => ({
      id: line.id,
      quantity: line.quantity,
      adjustmentDirection: line.adjustmentDirection,
      createdAt: line.createdAt,
      movement: {
        movementNumber: line.movement.movementNumber,
        movementType: line.movement.movementType,
        status: line.movement.status,
        challanNumber: line.movement.challanNumber,
        grnNumber: line.movement.grnNumber,
        remarks: line.movement.remarks,
        reason: line.movement.reason,
        machine: line.movement.machine,
        vendor: line.movement.vendor,
        transferFromProject: line.movement.transferFromProject,
        transferToProject: line.movement.transferToProject,
        actor: { displayName: line.movement.actor.displayName },
      },
      sourceLocation: line.sourceLocation,
      destinationLocation: line.destinationLocation,
      toolUnit: line.toolUnit,
    }));

    return NextResponse.json({
      data,
      pagination: { page, pageSize: PAGE_SIZE, total, totalPages: Math.ceil(total / PAGE_SIZE) },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
