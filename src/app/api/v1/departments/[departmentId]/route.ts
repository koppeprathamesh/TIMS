import { NextRequest, NextResponse } from "next/server";
import { getRequestContext } from "@/lib/authz/authorize";
import { errorResponse } from "@/lib/errors";
import { updateDepartment } from "@/lib/admin/org-structure";
import { updateDepartmentSchema } from "@/lib/validation/admin";
import { parseBody } from "@/lib/validation/parse";

interface Params {
  params: Promise<{ departmentId: string }>;
}

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { departmentId } = await params;
    const input = await parseBody(request, updateDepartmentSchema);
    return NextResponse.json({ data: await updateDepartment(ctx, departmentId, input) });
  } catch (error) {
    return errorResponse(error);
  }
}
