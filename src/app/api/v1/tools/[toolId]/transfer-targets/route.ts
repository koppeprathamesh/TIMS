import { NextRequest, NextResponse } from "next/server";
import { getRequestContext, requireOrganizationContext, requirePermission } from "@/lib/authz/authorize";
import { errorResponse } from "@/lib/errors";
import { PERMISSIONS } from "@/lib/authz/permissions";
import { listTransferTargets } from "@/lib/inventory/engine";

interface Params {
  params: Promise<{ toolId: string }>;
}

// Projects a tool may be transferred to: the other active projects in its own department.
export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    requirePermission(ctx, PERMISSIONS.STOCK_TRANSFER);
    requireOrganizationContext(ctx);
    const { toolId } = await params;
    const { targets } = await listTransferTargets(ctx, toolId);
    return NextResponse.json({ data: targets });
  } catch (error) {
    return errorResponse(error);
  }
}
