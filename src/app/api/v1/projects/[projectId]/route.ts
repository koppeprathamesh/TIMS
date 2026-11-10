import { NextRequest, NextResponse } from "next/server";
import { getRequestContext } from "@/lib/authz/authorize";
import { errorResponse } from "@/lib/errors";
import { deleteProject, updateProject } from "@/lib/admin/org-structure";
import { updateProjectSchema } from "@/lib/validation/admin";
import { parseBody } from "@/lib/validation/parse";

interface Params {
  params: Promise<{ projectId: string }>;
}

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { projectId } = await params;
    const input = await parseBody(request, updateProjectSchema);
    return NextResponse.json({ data: await updateProject(ctx, projectId, input) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { projectId } = await params;
    await deleteProject(ctx, projectId);
    return NextResponse.json({ data: { ok: true } });
  } catch (error) {
    return errorResponse(error);
  }
}
