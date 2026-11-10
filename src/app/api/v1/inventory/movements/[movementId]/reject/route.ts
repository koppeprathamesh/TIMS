import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getRequestContext } from "@/lib/authz/authorize";
import { errorResponse } from "@/lib/errors";
import { rejectMovement } from "@/lib/inventory/engine";
import { toMovementReceiptDto } from "@/lib/dto";
import { parseBody } from "@/lib/validation/parse";

interface Params {
  params: Promise<{ movementId: string }>;
}

const rejectSchema = z.object({
  reason: z.string().trim().min(3, "A reason is required.").max(500),
});

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { movementId } = await params;
    const { reason } = await parseBody(request, rejectSchema);
    return NextResponse.json({ data: toMovementReceiptDto(await rejectMovement(ctx, movementId, reason)) });
  } catch (error) {
    return errorResponse(error);
  }
}
