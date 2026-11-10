import { NextRequest, NextResponse } from "next/server";
import { getRequestContext } from "@/lib/authz/authorize";
import { errorResponse } from "@/lib/errors";
import { createUser, listUsers } from "@/lib/admin/users";
import { createUserSchema } from "@/lib/validation/admin";
import { parseBody } from "@/lib/validation/parse";

export async function GET() {
  try {
    const ctx = await getRequestContext();
    return NextResponse.json({ data: await listUsers(ctx) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getRequestContext();
    const input = await parseBody(request, createUserSchema);
    return NextResponse.json({ data: await createUser(ctx, input) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
