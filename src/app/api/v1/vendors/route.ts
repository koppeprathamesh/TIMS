import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  getRequestContext,
  requireFacilityContext,
  requireOrganizationContext,
  requirePermission,
} from "@/lib/authz/authorize";
import { AppError, errorResponse } from "@/lib/errors";
import { PERMISSIONS } from "@/lib/authz/permissions";
import { recordAuditEvent } from "@/lib/audit";
import { parseBody } from "@/lib/validation/parse";
import { uniqueCode } from "@/lib/validation/codes";

export async function GET() {
  try {
    const ctx = await getRequestContext();
    requirePermission(ctx, PERMISSIONS.MOVEMENT_READ);
    const facilityId = requireFacilityContext(ctx);

    const vendors = await prisma.vendor.findMany({
      where: { facilityId, status: "ACTIVE" },
      select: { id: true, code: true, name: true },
      orderBy: { name: "asc" },
    });

    return NextResponse.json({ data: vendors });
  } catch (error) {
    return errorResponse(error);
  }
}

const createVendorSchema = z.object({
  name: z.string().trim().min(1, "Enter a vendor name.").max(100),
});

// Lets whoever can record stock movements add a missing vendor on the spot.
export async function POST(request: NextRequest) {
  try {
    const ctx = await getRequestContext();
    requirePermission(ctx, PERMISSIONS.MOVEMENT_CREATE);
    const organizationId = requireOrganizationContext(ctx);
    const facilityId = requireFacilityContext(ctx);
    const input = await parseBody(request, createVendorSchema);

    const existing = await prisma.vendor.findMany({ where: { facilityId }, select: { code: true, name: true } });
    if (existing.some((v) => v.name.toLowerCase() === input.name.toLowerCase())) {
      throw AppError.conflict("A vendor with this name already exists.");
    }
    const code = uniqueCode(input.name, "VENDOR", new Set(existing.map((v) => v.code)));

    const vendor = await prisma.$transaction(async (tx) => {
      const created = await tx.vendor.create({
        data: { facilityId, code, name: input.name },
        select: { id: true, code: true, name: true },
      });
      await recordAuditEvent(
        {
          organizationId,
          actorId: ctx.userId,
          action: "vendor.create",
          resourceType: "Vendor",
          resourceId: created.id,
          metadata: { code: created.code },
        },
        tx
      );
      return created;
    });

    return NextResponse.json({ data: vendor }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
