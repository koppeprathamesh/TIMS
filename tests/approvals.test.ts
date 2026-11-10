import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { PERMISSIONS, ROLES } from "@/lib/authz/permissions";
import { approveMovement, createMovement, rejectMovement } from "@/lib/inventory/engine";
import { listNotifications } from "@/lib/admin/notifications";
import { createFixture, onHand } from "./helpers";
import { createMember } from "./admin-helpers";

type Fixture = Awaited<ReturnType<typeof createFixture>>;

async function setup() {
  const f = await createFixture();
  await createMovement(f.ctx, {
    facilityId: f.facility.id,
    movementType: "RECEIPT", grnNumber: "GRN1",
    lines: [{ toolId: f.tool.id, quantity: 10, destinationLocationId: f.locA.id }],
  });

  const requesterCtx = { ...f.ctx, permissions: new Set<string>([PERMISSIONS.STOCK_ADJUST]) };
  const approver = await createMember(f.org.id, `appr-${f.org.id}@t.local`, { role: ROLES.SUPER_ADMIN });
  const approverCtx = { ...f.ctx, userId: approver.id, permissions: new Set<string>([PERMISSIONS.STOCK_ADJUST_APPROVE]) };
  return { f, requesterCtx, approver, approverCtx };
}

function request(f: Fixture, ctx: Fixture["ctx"], quantity: number, decrease = false) {
  return createMovement(ctx, {
    facilityId: f.facility.id,
    movementType: "ADJUSTMENT",
    reason: "Cycle count",
    lines: [
      {
        toolId: f.tool.id,
        quantity,
        destinationLocationId: f.locA.id,
        adjustmentDirection: decrease ? "DECREASE" : "INCREASE",
      },
    ],
  });
}

describe("adjustment approval workflow", () => {
  it("holds a non-approver's adjustment without touching stock and notifies approvers", async () => {
    const { f, requesterCtx, approver } = await setup();
    const movement = await request(f, requesterCtx, 5);

    expect(movement.status).toBe("PENDING_APPROVAL");
    expect(await onHand(f.tool.id, f.locA.id)).toBe(10);
    expect(await prisma.auditEvent.count({ where: { resourceId: movement.id, action: "movement.adjustment_requested" } })).toBe(1);

    const inbox = (await listNotifications({ ...f.ctx, userId: approver.id })).items;
    expect(inbox.some((n) => n.type === "APPROVAL_REQUESTED" && n.title.includes(movement.movementNumber))).toBe(true);
    expect((await listNotifications(requesterCtx)).items.some((n) => n.type === "APPROVAL_REQUESTED")).toBe(false);
  });

  it("posts immediately when the requester can approve adjustments", async () => {
    const { f } = await setup();
    const movement = await request(f, f.ctx, 5);
    expect(movement.status).toBe("POSTED");
    expect(await onHand(f.tool.id, f.locA.id)).toBe(15);
  });

  it("applies stock on approval, records the approval and notifies the requester", async () => {
    const { f, requesterCtx, approverCtx } = await setup();
    const movement = await request(f, requesterCtx, 4, true);

    const posted = await approveMovement(approverCtx, movement.id);
    expect(posted.status).toBe("POSTED");
    expect(await onHand(f.tool.id, f.locA.id)).toBe(6);

    const approval = await prisma.approval.findFirstOrThrow({ where: { movementId: movement.id } });
    expect(approval).toMatchObject({ status: "APPROVED", approverId: approverCtx.userId });
    expect((await listNotifications(requesterCtx)).items.some((n) => n.type === "APPROVAL_APPROVED")).toBe(true);
    expect(await prisma.auditEvent.count({ where: { resourceId: movement.id, action: "movement.adjustment_approved" } })).toBe(1);
  });

  it("rejects with a reason, leaves stock untouched and blocks a second decision", async () => {
    const { f, requesterCtx, approverCtx } = await setup();
    const movement = await request(f, requesterCtx, 4);

    await expect(rejectMovement(approverCtx, movement.id, "  ")).rejects.toMatchObject({ status: 400 });
    const rejected = await rejectMovement(approverCtx, movement.id, "Count was wrong");
    expect(rejected.status).toBe("CANCELLED");
    expect(await onHand(f.tool.id, f.locA.id)).toBe(10);
    expect(await prisma.approval.findFirstOrThrow({ where: { movementId: movement.id } })).toMatchObject({
      status: "REJECTED",
      reason: "Count was wrong",
    });
    const note = (await listNotifications(requesterCtx)).items.find((n) => n.type === "APPROVAL_REJECTED");
    expect(note?.message).toContain("Count was wrong");

    await expect(approveMovement(approverCtx, movement.id)).rejects.toMatchObject({ status: 409 });
    await expect(rejectMovement(approverCtx, movement.id, "again")).rejects.toMatchObject({ status: 409 });
  });

  it("keeps the request pending when approval would make stock negative", async () => {
    const { f, requesterCtx, approverCtx } = await setup();
    const movement = await request(f, requesterCtx, 50, true);

    await expect(approveMovement(approverCtx, movement.id)).rejects.toMatchObject({ status: 409 });
    const after = await prisma.inventoryMovement.findUniqueOrThrow({ where: { id: movement.id } });
    expect(after.status).toBe("PENDING_APPROVAL");
    expect(await prisma.approval.count({ where: { movementId: movement.id } })).toBe(0);
    expect(await onHand(f.tool.id, f.locA.id)).toBe(10);
  });

  it("forbids self-approval, missing permission, other facilities and other organizations", async () => {
    const { f, requesterCtx, approverCtx } = await setup();
    const movement = await request(f, requesterCtx, 2);

    const selfCtx = { ...requesterCtx, permissions: new Set<string>([PERMISSIONS.STOCK_ADJUST_APPROVE]) };
    await expect(approveMovement(selfCtx, movement.id)).rejects.toMatchObject({ status: 403 });
    await expect(approveMovement(requesterCtx, movement.id)).rejects.toMatchObject({ status: 403 });

    const scoped = { ...approverCtx, unrestricted: false, grantedFacilityIds: new Set(["other-facility"]) };
    await expect(approveMovement(scoped, movement.id)).rejects.toMatchObject({ status: 403 });

    const other = await createFixture();
    await expect(approveMovement(other.ctx, movement.id)).rejects.toMatchObject({ status: 404 });

    expect((await prisma.inventoryMovement.findUniqueOrThrow({ where: { id: movement.id } })).status).toBe("PENDING_APPROVAL");
  });

  it("does not let two approvers apply the same request", async () => {
    const { f, requesterCtx, approverCtx } = await setup();
    const movement = await request(f, requesterCtx, 3);

    const results = await Promise.allSettled([
      approveMovement(approverCtx, movement.id),
      approveMovement(approverCtx, movement.id),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await onHand(f.tool.id, f.locA.id)).toBe(13);
  });
});
