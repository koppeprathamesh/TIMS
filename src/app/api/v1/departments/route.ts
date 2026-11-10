import { NextRequest, NextResponse } from "next/server";
import { getRequestContext } from "@/lib/authz/authorize";
import { AppError, errorResponse } from "@/lib/errors";
import { createDepartment, listDepartments } from "@/lib/admin/org-structure";
import { createDepartmentSchema } from "@/lib/validation/admin";
import { parseBody } from "@/lib/validation/parse";

// Defaults to the selected facility; `all=true` lists every department the caller may access.
export async function GET(request: NextRequest) {
  try {
    const ctx = await getRequestContext();
    const params = request.nextUrl.searchParams;
    const all = params.get("all") === "true";
    const facilityId = params.get("facilityId") ?? (all ? null : ctx.facilityId);
    if (!facilityId && !all) throw AppError.badRequest("facilityId is required.");
    const includeInactive = params.get("includeInactive") === "true";
    return NextResponse.json({ data: await listDepartments(ctx, { facilityId, includeInactive }) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getRequestContext();
    const input = await parseBody(request, createDepartmentSchema);
    return NextResponse.json({ data: await createDepartment(ctx, input) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
