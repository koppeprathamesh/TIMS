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
    requirePermission(ctx, PERMISSIONS.TOOL_READ);
    const facilityId = requireFacilityContext(ctx);

    const locations = await prisma.storageLocation.findMany({
      where: { facilityId, status: "ACTIVE" },
      select: { id: true, code: true, name: true },
      orderBy: { name: "asc" },
    });

    return NextResponse.json({ data: locations });
  } catch (error) {
    return errorResponse(error);
  }
}

const createLocationSchema = z.object({
  name: z.string().trim().min(1, "Enter a location name.").max(100),
  code: z.string().trim().max(40).optional().nullable(),
});

// Lets whoever can record stock movements add a missing location on the spot.
export async function POST(request: NextRequest) {
  try {
    const ctx = await getRequestContext();
    requirePermission(ctx, PERMISSIONS.MOVEMENT_CREATE);
    const organizationId = requireOrganizationContext(ctx);
    const facilityId = requireFacilityContext(ctx);
    const input = await parseBody(request, createLocationSchema);

    const existing = await prisma.storageLocation.findMany({ where: { facilityId }, select: { code: true, name: true } });
    if (existing.some((l) => l.name.toLowerCase() === input.name.toLowerCase())) {
      throw AppError.conflict("A location with this name already exists.");
    }
    const taken = new Set(existing.map((l) => l.code));

    let code = input.code?.trim();
    if (code) {
      if (taken.has(code)) throw AppError.conflict("A location with this code already exists.");
    } else {
      code = uniqueCode(input.name, "LOC", taken);
    }

    const location = await prisma.$transaction(async (tx) => {
      const created = await tx.storageLocation.create({
        data: { facilityId, code: code!, name: input.name },
        select: { id: true, code: true, name: true },
      });
      await recordAuditEvent(
        {
          organizationId,
          actorId: ctx.userId,
          action: "storage_location.create",
          resourceType: "StorageLocation",
          resourceId: created.id,
          metadata: { code: created.code },
        },
        tx
      );
      return created;
    });

    return NextResponse.json({ data: location }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
