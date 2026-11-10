import { NextRequest, NextResponse } from "next/server";
import { getRequestContext } from "@/lib/authz/authorize";
import { errorResponse } from "@/lib/errors";
import { markNotificationRead } from "@/lib/admin/notifications";

interface Params {
  params: Promise<{ notificationId: string }>;
}

export async function POST(_request: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { notificationId } = await params;
    await markNotificationRead(ctx, notificationId);
    return NextResponse.json({ data: { ok: true } });
  } catch (error) {
    return errorResponse(error);
  }
}
