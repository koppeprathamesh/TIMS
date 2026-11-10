import { NextRequest, NextResponse } from "next/server";
import { getRequestContext } from "@/lib/authz/authorize";
import { errorResponse } from "@/lib/errors";
import { createProject, listProjects } from "@/lib/admin/org-structure";
import { createProjectSchema } from "@/lib/validation/admin";
import { parseBody } from "@/lib/validation/parse";

// Defaults to the selected context (department, else facility). `level=facility` ignores the
// selected department; `all=true` lists every project the caller may access.
export async function GET(request: NextRequest) {
  try {
    const ctx = await getRequestContext();
    const params = request.nextUrl.searchParams;
    const all = params.get("all") === "true";
    const facilityLevel = params.get("level") === "facility";
    const departmentId =
      params.get("departmentId") ?? (all || facilityLevel ? null : ctx.departmentId);
    const facilityId = departmentId || all ? null : (params.get("facilityId") ?? ctx.facilityId);
    const projects = await listProjects(ctx, {
      departmentId,
      facilityId,
      includeArchived: params.get("includeArchived") === "true",
    });
    return NextResponse.json({ data: projects });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getRequestContext();
    const input = await parseBody(request, createProjectSchema);
    return NextResponse.json({ data: await createProject(ctx, input) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
