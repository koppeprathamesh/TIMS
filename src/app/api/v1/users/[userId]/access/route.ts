import { NextRequest, NextResponse } from "next/server";
import { getRequestContext } from "@/lib/authz/authorize";
import { errorResponse } from "@/lib/errors";
import { setUserAccess } from "@/lib/admin/users";
import { setUserAccessSchema } from "@/lib/validation/admin";
import { parseBody } from "@/lib/validation/parse";

interface Params {
  params: Promise<{ userId: string }>;
}

export async function PUT(request: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { userId } = await params;
    const input = await parseBody(request, setUserAccessSchema);
    await setUserAccess(ctx, userId, input);
    return NextResponse.json({ data: { ok: true } });
  } catch (error) {
    return errorResponse(error);
  }
}
