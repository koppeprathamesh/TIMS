import { NextRequest, NextResponse } from "next/server";
import { getRequestContext } from "@/lib/authz/authorize";
import { errorResponse } from "@/lib/errors";
import { updateUser } from "@/lib/admin/users";
import { updateUserSchema } from "@/lib/validation/admin";
import { parseBody } from "@/lib/validation/parse";

interface Params {
  params: Promise<{ userId: string }>;
}

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { userId } = await params;
    const input = await parseBody(request, updateUserSchema);
    return NextResponse.json({ data: await updateUser(ctx, userId, input) });
  } catch (error) {
    return errorResponse(error);
  }
}
