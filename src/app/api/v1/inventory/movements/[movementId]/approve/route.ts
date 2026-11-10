import { NextRequest, NextResponse } from "next/server";
import { getRequestContext } from "@/lib/authz/authorize";
import { errorResponse } from "@/lib/errors";
import { approveMovement } from "@/lib/inventory/engine";
import { toMovementReceiptDto } from "@/lib/dto";

interface Params {
  params: Promise<{ movementId: string }>;
}

export async function POST(_request: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { movementId } = await params;
    return NextResponse.json({ data: toMovementReceiptDto(await approveMovement(ctx, movementId)) });
  } catch (error) {
    return errorResponse(error);
  }
}
