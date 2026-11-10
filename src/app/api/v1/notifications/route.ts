import { NextRequest, NextResponse } from "next/server";
import { getRequestContext } from "@/lib/authz/authorize";
import { errorResponse } from "@/lib/errors";
import { listNotifications } from "@/lib/admin/notifications";

export async function GET(request: NextRequest) {
  try {
    const ctx = await getRequestContext();
    const unreadOnly = request.nextUrl.searchParams.get("unread") === "true";
    return NextResponse.json(await listNotifications(ctx, { unreadOnly }));
  } catch (error) {
    return errorResponse(error);
  }
}
