import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { RequestContext } from "@/lib/authz/authorize";
import { PERMISSIONS, ROLES, ROLE_CODES, ROLE_PERMISSIONS } from "@/lib/authz/permissions";

// Notifications are personal: every query is scoped to the signed-in user.
export async function listNotifications(ctx: RequestContext, opts: { unreadOnly?: boolean } = {}) {
  const [items, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: ctx.userId, ...(opts.unreadOnly ? { readAt: null } : {}) },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.notification.count({ where: { userId: ctx.userId, readAt: null } }),
  ]);
  return { items, unreadCount };
}

export async function markNotificationRead(ctx: RequestContext, notificationId: string) {
  const result = await prisma.notification.updateMany({
    where: { id: notificationId, userId: ctx.userId, readAt: null },
    data: { readAt: new Date() },
  });
  if (result.count === 0) {
    const exists = await prisma.notification.findFirst({ where: { id: notificationId, userId: ctx.userId } });
    if (!exists) throw AppError.notFound("Notification not found.");
  }
}

export async function markAllNotificationsRead(ctx: RequestContext) {
  const result = await prisma.notification.updateMany({
    where: { userId: ctx.userId, readAt: null },
    data: { readAt: new Date() },
  });
  return result.count;
}

interface NotificationContent {
  type: string;
  title: string;
  message: string;
}

// Best-effort: a failed notification must never undo the business action that triggered it.
export async function notifyUser(userId: string, content: NotificationContent) {
  try {
    await prisma.notification.create({ data: { userId, ...content } });
  } catch (error) {
    console.error("Failed to create notification", error);
  }
}

// Active org members whose role grants `permission` and whose scope covers the facility.
async function findFacilityRecipients(organizationId: string, facilityId: string, permission: string) {
  const roles = ROLE_CODES.filter((r) => ROLE_PERMISSIONS[r].includes(permission));
  return prisma.user.findMany({
    where: {
      status: "ACTIVE",
      memberships: { some: { organizationId, status: "ACTIVE" } },
      OR: [
        { role: ROLES.SUPER_ADMIN },
        { role: ROLES.INVENTORY_ADMIN, adminFacilities: { some: { facilityId } } },
        { role: ROLES.USER, departmentAccess: { some: { department: { facilityId } } } },
      ].filter((clause) => (roles as string[]).includes(clause.role)),
    },
    select: { id: true },
  });
}

// Notifies active users who can approve adjustments for the facility.
export async function notifyApprovers(
  organizationId: string,
  facilityId: string,
  excludeUserId: string,
  content: NotificationContent
) {
  try {
    const approvers = (await findFacilityRecipients(organizationId, facilityId, PERMISSIONS.STOCK_ADJUST_APPROVE)).filter(
      (u) => u.id !== excludeUserId
    );
    for (const approver of approvers) {
      await prisma.notification.create({ data: { userId: approver.id, ...content } });
    }
  } catch (error) {
    console.error("Failed to notify approvers", error);
  }
}

// Notifies users with access to the facility who can read inventory summaries when a tool's
// available stock in the facility falls below its minimum. An unread alert for
// the same tool is not duplicated. Never throws: alerting must not fail a posted movement.
export async function notifyLowStock(organizationId: string, facilityId: string, toolIds: string[]) {
  try {
    const tools = await prisma.tool.findMany({
      where: { id: { in: toolIds }, organizationId, status: "ACTIVE", minimumQuantity: { gt: 0 } },
      select: { id: true, code: true, name: true, minimumQuantity: true },
    });
    if (!tools.length) return;

    const balances = await prisma.inventoryBalance.groupBy({
      by: ["toolId"],
      where: { facilityId, stockStatus: "AVAILABLE", toolId: { in: tools.map((t) => t.id) } },
      _sum: { onHandQuantity: true },
    });
    const available = new Map(balances.map((b) => [b.toolId, b._sum.onHandQuantity ?? 0]));
    const low = tools.filter((t) => (available.get(t.id) ?? 0) < t.minimumQuantity);
    if (!low.length) return;

    const recipients = await findFacilityRecipients(organizationId, facilityId, PERMISSIONS.INVENTORY_SUMMARY_READ);

    for (const tool of low) {
      const title = `Low stock: ${tool.code}`;
      const message = `${tool.name} has ${available.get(tool.id) ?? 0} available (minimum ${tool.minimumQuantity}).`;
      for (const user of recipients) {
        const open = await prisma.notification.findFirst({
          where: { userId: user.id, type: "LOW_STOCK", title, readAt: null },
        });
        if (open) continue;
        await prisma.notification.create({ data: { userId: user.id, type: "LOW_STOCK", title, message } });
      }
    }
  } catch (error) {
    console.error("Failed to create low-stock notifications", error);
  }
}
