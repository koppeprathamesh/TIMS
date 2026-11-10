import { NextRequest, NextResponse } from "next/server";
import { getRequestContext } from "@/lib/authz/authorize";
import { errorResponse } from "@/lib/errors";
import { createFacility, listFacilities } from "@/lib/admin/org-structure";
import { createFacilitySchema } from "@/lib/validation/admin";
import { parseBody } from "@/lib/validation/parse";

export async function GET(request: NextRequest) {
  try {
    const ctx = await getRequestContext();
    const includeInactive = request.nextUrl.searchParams.get("includeInactive") === "true";
    return NextResponse.json({ data: await listFacilities(ctx, { includeInactive }) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getRequestContext();
    const input = await parseBody(request, createFacilitySchema);
    return NextResponse.json({ data: await createFacility(ctx, input) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
