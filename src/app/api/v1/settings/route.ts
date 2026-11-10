import { NextRequest, NextResponse } from "next/server";
import { getRequestContext } from "@/lib/authz/authorize";
import { errorResponse } from "@/lib/errors";
import { getSettings, updateOrganization } from "@/lib/admin/settings";
import { updateOrganizationSchema } from "@/lib/validation/admin";
import { parseBody } from "@/lib/validation/parse";

export async function GET() {
  try {
    const ctx = await getRequestContext();
    return NextResponse.json({ data: await getSettings(ctx) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const ctx = await getRequestContext();
    const input = await parseBody(request, updateOrganizationSchema);
    return NextResponse.json({ data: await updateOrganization(ctx, input) });
  } catch (error) {
    return errorResponse(error);
  }
}
