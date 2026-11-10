import { NextResponse } from "next/server";
import { getRequestContext } from "@/lib/authz/authorize";
import { errorResponse } from "@/lib/errors";

export async function GET() {
  try {
    const ctx = await getRequestContext();
    return NextResponse.json({ role: ctx.role, permissions: Array.from(ctx.permissions) });
  } catch (error) {
    return errorResponse(error);
  }
}
