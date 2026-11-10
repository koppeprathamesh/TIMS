import { NextRequest, NextResponse } from "next/server";
import { getRequestContext } from "@/lib/authz/authorize";
import { errorResponse } from "@/lib/errors";
import { updateFacility } from "@/lib/admin/org-structure";
import { updateFacilitySchema } from "@/lib/validation/admin";
import { parseBody } from "@/lib/validation/parse";

interface Params {
  params: Promise<{ facilityId: string }>;
}

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { facilityId } = await params;
    const input = await parseBody(request, updateFacilitySchema);
    return NextResponse.json({ data: await updateFacility(ctx, facilityId, input) });
  } catch (error) {
    return errorResponse(error);
  }
}
