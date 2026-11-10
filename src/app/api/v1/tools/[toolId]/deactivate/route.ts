import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  getRequestContext,
  requireOrganizationContext,
  requirePermission,
  requireToolInScope,
} from "@/lib/authz/authorize";
import { errorResponse } from "@/lib/errors";
import { PERMISSIONS } from "@/lib/authz/permissions";
import { recordAuditEvent } from "@/lib/audit";
import { toToolSummaryDto } from "@/lib/dto";

interface Params {
  params: Promise<{ toolId: string }>;
}

export async function POST(_request: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    requirePermission(ctx, PERMISSIONS.TOOL_DEACTIVATE);
    const organizationId = requireOrganizationContext(ctx);
    const { toolId } = await params;

    const tool = await requireToolInScope(ctx, toolId);

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.tool.update({
        where: { id: toolId },
        data: { status: "INACTIVE", updatedById: ctx.userId, version: { increment: 1 } },
      });
      await recordAuditEvent(
        { organizationId, actorId: ctx.userId, action: "tool.deactivate", resourceType: "Tool", resourceId: tool.id },
        tx
      );
      return result;
    });

    return NextResponse.json({ data: toToolSummaryDto(updated) });
  } catch (error) {
    return errorResponse(error);
  }
}
