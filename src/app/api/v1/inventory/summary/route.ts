import { NextResponse } from "next/server";
import {
  getRequestContext,
  requireFacilityContext,
  requirePermission,
} from "@/lib/authz/authorize";
import { errorResponse } from "@/lib/errors";
import { PERMISSIONS } from "@/lib/authz/permissions";
import { getInventorySummary } from "@/lib/inventory/stock";

export async function GET() {
  try {
    const ctx = await getRequestContext();
    requirePermission(ctx, PERMISSIONS.INVENTORY_SUMMARY_READ);
    const facilityId = requireFacilityContext(ctx);

    const summary = await getInventorySummary(ctx, facilityId);
    return NextResponse.json({ data: summary });
  } catch (error) {
    return errorResponse(error);
  }
}
