import { signSession } from "@/lib/auth/session";
import { resolveAccessScope } from "@/lib/authz/authorize";
import { isRoleCode, ROLES } from "@/lib/authz/permissions";
import { autoSelectWorkspace } from "@/lib/auth/workspace";

interface SessionUser {
  id: string;
  role: string;
  tokenVersion: number;
  lastFacilityId: string | null;
  lastDepartmentId: string | null;
  lastProjectId: string | null;
}

// Issues a session cookie value. The last workspace is restored only if it is still valid in the
// user's current scope; otherwise single-option levels are chosen automatically.
export async function issueSession(user: SessionUser, organizationId: string | undefined) {
  let workspace = { facilityId: null as string | null, departmentId: null as string | null, projectId: null as string | null };
  if (organizationId) {
    const role = isRoleCode(user.role) ? user.role : ROLES.USER;
    const scope = await resolveAccessScope(user.id, role, organizationId);
    workspace = await autoSelectWorkspace(organizationId, scope, {
      facilityId: user.lastFacilityId,
      departmentId: user.lastDepartmentId,
      projectId: user.lastProjectId,
    });
  }
  return signSession({
    userId: user.id,
    tv: user.tokenVersion,
    organizationId,
    facilityId: workspace.facilityId ?? undefined,
    departmentId: workspace.departmentId ?? undefined,
    projectId: workspace.projectId,
  });
}
