import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  getRequestContext,
  assertDepartmentAccess,
  assertFacilityAccess,
  assertProjectAccess,
  requireOrganizationContext,
  scopeOf,
} from "@/lib/authz/authorize";
import { AppError, errorResponse } from "@/lib/errors";
import { signSession, SESSION_COOKIE_NAME, sessionCookieOptions } from "@/lib/auth/session";
import { contextSchema } from "@/lib/validation/auth";
import {
  autoSelectWorkspace,
  rememberWorkspace,
  resolveWorkspace,
  workspaceStepFor,
  type WorkspaceIds,
} from "@/lib/auth/workspace";

export async function POST(request: NextRequest) {
  try {
    const ctx = await getRequestContext();
    const organizationId = requireOrganizationContext(ctx);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw AppError.badRequest("Request body must be valid JSON.");
    }
    const parsed = contextSchema.safeParse(body);
    if (!parsed.success) {
      throw AppError.badRequest("Invalid context selection.", parsed.error.flatten());
    }
    const { facilityId, departmentId, projectId } = parsed.data;

    // Start from the live, validated workspace and replace the chosen level; every level below
    // it is reset (and then re-chosen automatically when only one option exists).
    const current = await resolveWorkspace(ctx);
    let preferred: Partial<WorkspaceIds> = {
      facilityId: current.facility?.id ?? null,
      departmentId: current.department?.id ?? null,
      projectId: current.project?.id ?? null,
    };

    if (facilityId) {
      const facility = await prisma.facility.findFirst({
        where: { id: facilityId, organizationId, status: "ACTIVE" },
      });
      if (!facility) throw AppError.notFound("Plant not found.");
      assertFacilityAccess(ctx, facilityId);
      preferred = { facilityId };
    }

    if (departmentId) {
      if (!preferred.facilityId) throw AppError.badRequest("Choose a plant before selecting a project.");
      assertFacilityAccess(ctx, preferred.facilityId);
      assertDepartmentAccess(ctx, departmentId);
      const department = await prisma.department.findFirst({
        where: { id: departmentId, facilityId: preferred.facilityId, status: "ACTIVE" },
      });
      if (!department) throw AppError.notFound("Project not found.");
      preferred = { facilityId: preferred.facilityId, departmentId };
    }

    if (projectId) {
      if (!preferred.facilityId) throw AppError.badRequest("Choose a plant before selecting a part.");
      assertFacilityAccess(ctx, preferred.facilityId);
      const project = await prisma.project.findFirst({
        where: { id: projectId, organizationId, status: "ACTIVE" },
        select: { id: true, departmentId: true, department: { select: { facilityId: true } } },
      });
      if (!project) throw AppError.notFound("Part not found.");
      assertProjectAccess(ctx, projectId);
      // A project belongs to exactly one department, which belongs to one facility.
      if (
        !project.departmentId ||
        project.department?.facilityId !== preferred.facilityId ||
        (departmentId && project.departmentId !== departmentId)
      ) {
        throw AppError.badRequest("This part does not belong to the selected plant/project.");
      }
      preferred = { facilityId: preferred.facilityId, departmentId: project.departmentId, projectId };
    }

    const selection = await autoSelectWorkspace(organizationId, scopeOf(ctx), preferred);
    const workspaceStep = workspaceStepFor(selection);
    await rememberWorkspace(ctx.userId, selection);

    const token = signSession({
      userId: ctx.userId,
      tv: ctx.tokenVersion ?? 0,
      organizationId,
      facilityId: selection.facilityId ?? undefined,
      departmentId: selection.departmentId ?? undefined,
      projectId: selection.projectId,
    });

    const response = NextResponse.json({ ...selection, workspaceStep });
    response.cookies.set(SESSION_COOKIE_NAME, token, sessionCookieOptions(request));
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
