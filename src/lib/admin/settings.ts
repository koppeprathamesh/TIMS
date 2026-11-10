import { prisma } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import {
  type RequestContext,
  requireOrganizationContext,
  requirePermission,
} from "@/lib/authz/authorize";
import { PERMISSIONS } from "@/lib/authz/permissions";

export async function getSettings(ctx: RequestContext) {
  requirePermission(ctx, PERMISSIONS.SETTINGS_READ);
  const organizationId = requireOrganizationContext(ctx);

  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { id: true, name: true, code: true },
  });
  return { organization };
}

export async function updateOrganization(ctx: RequestContext, input: { name: string }) {
  requirePermission(ctx, PERMISSIONS.SETTINGS_MANAGE);
  const organizationId = requireOrganizationContext(ctx);

  const org = await prisma.organization.update({ where: { id: organizationId }, data: { name: input.name } });
  await recordAuditEvent({
    organizationId,
    actorId: ctx.userId,
    action: "settings.organization_update",
    resourceType: "Organization",
    resourceId: organizationId,
    metadata: { name: input.name },
  });
  return { id: org.id, name: org.name, code: org.code };
}
