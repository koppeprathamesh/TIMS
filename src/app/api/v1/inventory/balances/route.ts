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

const query = z.object({ toolId: z.string().max(64).optional() });

// On-hand stock per tool/location/status for tools in the caller's workspace.
export async function GET(request: NextRequest) {
  try {
    const ctx = await getRequestContext();
    requirePermission(ctx, PERMISSIONS.STOCK_READ);
    const organizationId = requireOrganizationContext(ctx);
    const facilityId = requireFacilityContext(ctx);
    const { toolId } = parseQuery(request, query);

    const balances = await prisma.inventoryBalance.findMany({
      where: {
        facilityId,
        ...(toolId ? { toolId } : {}),
        tool: { AND: [{ organizationId }, toolScopeWhere(ctx, facilityId, { includeUnassigned: true })] },
      },
      select: {
        toolId: true,
        stockStatus: true,
        onHandQuantity: true,
        location: { select: { id: true, name: true, code: true } },
      },
      orderBy: [{ toolId: "asc" }, { locationId: "asc" }],
    });

    return NextResponse.json({ data: balances });
  } catch (error) {
    return errorResponse(error);
  }
}
