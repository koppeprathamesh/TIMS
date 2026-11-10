import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  getRequestContext,
  requireFacilityContext,
  requireOrganizationContext,
  requirePermission,
  toolScopeWhere,
} from "@/lib/authz/authorize";
import { errorResponse } from "@/lib/errors";
import { PERMISSIONS } from "@/lib/authz/permissions";
import { parseQuery } from "@/lib/validation/parse";
import { backfillUnits } from "@/lib/inventory/units";

const query = z.object({
  locationId: z.string().min(1).max(64).optional(),
  status: z.enum(["AVAILABLE", "SHARPENING", "ISSUED"]).default("AVAILABLE"),
  toolId: z.string().max(64).optional(),
});

// Individual tool items currently in the given status, for picking by ID. Each item reports the
// storage location it is in (or, for issued items, the one it returns to: its tool's location), so
// movements never ask the user for a location.
export async function GET(request: NextRequest) {
  try {
    const ctx = await getRequestContext();
    requirePermission(ctx, PERMISSIONS.MOVEMENT_READ);
    const organizationId = requireOrganizationContext(ctx);
    const facilityId = requireFacilityContext(ctx);
    const q = parseQuery(request, query);

    if (q.locationId) {
      const location = await prisma.storageLocation.findFirst({ where: { id: q.locationId, facilityId }, select: { id: true } });
      if (!location) return NextResponse.json({ data: [] });
    }

    if (q.status !== "ISSUED") {
      // Stock received before unit tracking gets its units the first time it is looked up.
      await prisma.$transaction((tx) =>
        backfillUnits(tx, {
          facilityId,
          locationId: q.locationId,
          status: q.status as "AVAILABLE" | "SHARPENING",
          toolId: q.toolId,
        })
      );
    }

    const units = await prisma.toolUnit.findMany({
      where: {
        facilityId,
        ...(q.locationId ? { locationId: q.locationId } : {}),
        status: q.status,
        ...(q.toolId ? { toolId: q.toolId } : {}),
        tool: { AND: [{ organizationId, status: "ACTIVE" }, toolScopeWhere(ctx, facilityId, { includeUnassigned: true })] },
      },
      select: {
        id: true,
        serialNumber: true,
        toolId: true,
        location: { select: { name: true } },
        tool: { select: { code: true, name: true, defaultLocation: { select: { name: true } } } },
      },
      orderBy: [{ tool: { code: "asc" } }, { sequence: "asc" }],
      take: 500,
    });

    return NextResponse.json({
      data: units.map((u) => ({
        id: u.id,
        serialNumber: u.serialNumber,
        toolId: u.toolId,
        toolCode: u.tool.code,
        toolName: u.tool.name,
        locationName: (q.status === "ISSUED" ? u.tool.defaultLocation?.name : u.location?.name) ?? null,
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
