import { prisma } from "@/lib/db";
import { getRequestContext } from "@/lib/authz/authorize";
import { errorResponse } from "@/lib/errors";
import { NextResponse } from "next/server";
import { resolveWorkspace } from "@/lib/auth/workspace";

export async function GET() {
  try {
    const ctx = await getRequestContext();
    const user = await prisma.user.findUnique({
      where: { id: ctx.userId },
      select: { id: true, email: true, displayName: true },
    });

    let organization = null;
    if (ctx.organizationId) {
      organization = await prisma.organization.findUnique({ where: { id: ctx.organizationId } });
    }
    const workspace = await resolveWorkspace(ctx);

    return NextResponse.json({
      user: user ? { ...user, role: ctx.role } : null,
      organization,
      ...workspace,
      role: ctx.role,
      permissions: Array.from(ctx.permissions),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
