import { prisma } from "@/lib/db";
import type { AccessScope, RequestContext } from "@/lib/authz/authorize";
import type { WorkspaceStep } from "@/lib/navigation";

export interface WorkspaceIds {
  facilityId: string | null;
  departmentId: string | null;
  projectId: string | null;
}

export function workspaceStepFor(ids: WorkspaceIds): WorkspaceStep {
  if (!ids.facilityId) return "facility";
  if (!ids.departmentId) return "department";
  if (!ids.projectId) return "project";
  return "ready";
}

// Cookies record selections, not authority. Recheck live scope, status and ancestry
// before restoring a workspace from a cached route or browser history.
export async function resolveWorkspace(ctx: RequestContext) {
  const facility = ctx.organizationId && ctx.facilityId &&
    (ctx.unrestricted || ctx.grantedFacilityIds.has(ctx.facilityId))
    ? await prisma.facility.findFirst({
        where: { id: ctx.facilityId, organizationId: ctx.organizationId, status: "ACTIVE" },
        select: { id: true, name: true },
      })
    : null;
  const department = facility && ctx.departmentId &&
    (ctx.unrestricted || ctx.grantedDepartmentIds.has(ctx.departmentId))
    ? await prisma.department.findFirst({
        where: { id: ctx.departmentId, facilityId: facility.id, status: "ACTIVE" },
        select: { id: true, name: true },
      })
    : null;
  const project = department && ctx.projectId &&
    (ctx.unrestricted || ctx.grantedProjectIds.has(ctx.projectId))
    ? await prisma.project.findFirst({
        where: {
          id: ctx.projectId,
          organizationId: ctx.organizationId ?? undefined,
          status: "ACTIVE",
          departmentId: department.id,
        },
        select: { id: true, name: true },
      })
    : null;

  const workspaceStep = workspaceStepFor({
    facilityId: facility?.id ?? null,
    departmentId: department?.id ?? null,
    projectId: project?.id ?? null,
  });
  return { facility, department, project, workspaceStep };
}

// Walks facility -> department -> project, keeping each preferred id that is still valid and
// automatically choosing a level when exactly one accessible, active option exists. Used at sign-in
// (restoring the last workspace) and after every selection so users are never asked to pick from a
// single-item list.
export async function autoSelectWorkspace(
  organizationId: string,
  scope: AccessScope,
  preferred: Partial<WorkspaceIds> = {}
): Promise<WorkspaceIds> {
  const result: WorkspaceIds = { facilityId: null, departmentId: null, projectId: null };

  const facilities = await prisma.facility.findMany({
    where: {
      organizationId,
      status: "ACTIVE",
      ...(scope.unrestricted ? {} : { id: { in: [...scope.facilityIds] } }),
    },
    select: { id: true },
  });
  const facilityId =
    facilities.find((f) => f.id === preferred.facilityId)?.id ??
    (facilities.length === 1 ? facilities[0].id : null);
  if (!facilityId) return result;
  result.facilityId = facilityId;

  const departments = await prisma.department.findMany({
    where: {
      facilityId,
      status: "ACTIVE",
      ...(scope.unrestricted ? {} : { id: { in: [...scope.departmentIds] } }),
    },
    select: { id: true },
  });
  const departmentId =
    departments.find((d) => d.id === preferred.departmentId)?.id ??
    (departments.length === 1 ? departments[0].id : null);
  if (!departmentId) return result;
  result.departmentId = departmentId;

  const projects = await prisma.project.findMany({
    where: {
      organizationId,
      departmentId,
      status: "ACTIVE",
      ...(scope.unrestricted ? {} : { id: { in: [...scope.projectIds] } }),
    },
    select: { id: true },
  });
  result.projectId =
    projects.find((p) => p.id === preferred.projectId)?.id ??
    (projects.length === 1 ? projects[0].id : null);
  return result;
}

// Remembers the last selected workspace so the next sign-in can restore it.
export async function rememberWorkspace(userId: string, ids: WorkspaceIds) {
  await prisma.user.update({
    where: { id: userId },
    data: { lastFacilityId: ids.facilityId, lastDepartmentId: ids.departmentId, lastProjectId: ids.projectId },
  });
}
