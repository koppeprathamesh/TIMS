import { NextResponse } from "next/server";
import { getRequestContext } from "@/lib/authz/authorize";
import { errorResponse } from "@/lib/errors";
import { markAllNotificationsRead } from "@/lib/admin/notifications";

export async function POST() {
  try {
    const ctx = await getRequestContext();
    return NextResponse.json({ data: { updated: await markAllNotificationsRead(ctx) } });
  } catch (error) {
    return errorResponse(error);
  }
}
