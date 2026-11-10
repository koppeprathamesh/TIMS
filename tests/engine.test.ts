import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { PERMISSIONS } from "@/lib/authz/permissions";
import { createMovement, reverseMovement } from "@/lib/inventory/engine";
import { AppError } from "@/lib/errors";
import { createFixture, createTool, onHand } from "./helpers";
import { createDepartment, createMember, createProject } from "./admin-helpers";

async function receive(f: Awaited<ReturnType<typeof createFixture>>, quantity: number) {
  return createMovement(f.ctx, {
    facilityId: f.facility.id,
    movementType: "RECEIPT", grnNumber: "GRN1",
    lines: [{ toolId: f.tool.id, quantity, destinationLocationId: f.locA.id }],
  });
}

describe("inventory engine", () => {
  it("receipt increases available stock", async () => {
    const f = await createFixture();
    await receive(f, 10);
    expect(await onHand(f.tool.id, f.locA.id)).toBe(10);
  });

  it("issue decreases stock and rejects insufficient stock without side effects", async () => {
    const f = await createFixture();
    await receive(f, 10);
    await createMovement(f.ctx, {
      facilityId: f.facility.id,
      movementType: "ISSUE",
      lines: [{ toolId: f.tool.id, quantity: 4, sourceLocationId: f.locA.id }],
    });
    expect(await onHand(f.tool.id, f.locA.id)).toBe(6);

    const failure = createMovement(f.ctx, {
      facilityId: f.facility.id,
      movementType: "ISSUE",
      lines: [{ toolId: f.tool.id, quantity: 7, sourceLocationId: f.locA.id }],
    });
    await expect(failure).rejects.toMatchObject({ status: 409 });
    expect(await onHand(f.tool.id, f.locA.id)).toBe(6);
  });

  it("transfer moves a tool to another project in the same department", async () => {
    const f = await createFixture();
    const department = await createDepartment(f.facility.id);
    const from = await createProject(f.org.id, department.id, "From");
    const to = await createProject(f.org.id, department.id, "To");
    const other = await createProject(f.org.id, (await createDepartment(f.facility.id, "Other")).id, "Elsewhere");
    const tool = await createTool(f.org.id, { code: "TRF-1", projectId: from.id });

    await expect(
      createMovement(f.ctx, {
        facilityId: f.facility.id,
        movementType: "TRANSFER",
        transferToProjectId: other.id,
        lines: [{ toolId: tool.id, quantity: 0 }],
      })
    ).rejects.toMatchObject({ status: 400 });

    await createMovement(f.ctx, {
      facilityId: f.facility.id,
      movementType: "TRANSFER",
      transferToProjectId: to.id,
      lines: [{ toolId: tool.id, quantity: 0 }],
    });
    expect((await prisma.tool.findUniqueOrThrow({ where: { id: tool.id } })).projectId).toBe(to.id);
  });

  it("receipt creates a unique ID per tool, and issue/sharpening act on the picked ID", async () => {
    const f = await createFixture();
    await receive(f, 3);
    const units = await prisma.toolUnit.findMany({ where: { toolId: f.tool.id }, orderBy: { sequence: "asc" } });
    expect(units.map((u) => u.serialNumber)).toEqual([`${f.tool.code}-1`, `${f.tool.code}-2`, `${f.tool.code}-3`]);

    await createMovement(f.ctx, {
      facilityId: f.facility.id,
      movementType: "ISSUE",
      lines: [{ toolId: f.tool.id, quantity: 5, toolUnitId: units[1].id, sourceLocationId: f.locA.id }],
    });
    expect((await prisma.toolUnit.findUniqueOrThrow({ where: { id: units[1].id } })).status).toBe("ISSUED");
    expect(await onHand(f.tool.id, f.locA.id)).toBe(2);

    // An issued ID can no longer be picked.
    await expect(
      createMovement(f.ctx, {
        facilityId: f.facility.id,
        movementType: "SHARPEN_DISPATCH",
        lines: [{ toolId: f.tool.id, quantity: 1, toolUnitId: units[1].id, sourceLocationId: f.locA.id }],
      })
    ).rejects.toMatchObject({ status: 409 });

    await createMovement(f.ctx, {
      facilityId: f.facility.id,
      movementType: "SHARPEN_DISPATCH",
      lines: [{ toolId: f.tool.id, quantity: 1, toolUnitId: units[2].id, sourceLocationId: f.locA.id }],
    });
    expect((await prisma.toolUnit.findUniqueOrThrow({ where: { id: units[2].id } })).status).toBe("SHARPENING");
  });

  it("moves several picked tool IDs in one transaction for return, scrap and transfer", async () => {
    const f = await createFixture();
    await receive(f, 4);
    const units = await prisma.toolUnit.findMany({ where: { toolId: f.tool.id }, orderBy: { sequence: "asc" } });
    const line = (i: number, extra: object) => ({ toolId: f.tool.id, quantity: 1, toolUnitId: units[i].id, ...extra });

    await createMovement(f.ctx, {
      facilityId: f.facility.id,
      movementType: "ISSUE",
      lines: [0, 1, 2].map((i) => line(i, { sourceLocationId: f.locA.id })),
    });
    expect(await onHand(f.tool.id, f.locA.id)).toBe(1);

    // Only the chosen issued IDs come back; the third stays issued.
    const ret = await createMovement(f.ctx, {
      facilityId: f.facility.id,
      movementType: "RETURN",
      lines: [0, 1].map((i) => line(i, { destinationLocationId: f.locA.id })),
    });
    expect(ret.lines).toHaveLength(2);
    const statuses = async () =>
      (await prisma.toolUnit.findMany({ where: { toolId: f.tool.id }, orderBy: { sequence: "asc" } })).map((u) => u.status);
    expect(await statuses()).toEqual(["AVAILABLE", "AVAILABLE", "ISSUED", "AVAILABLE"]);
    expect(await onHand(f.tool.id, f.locA.id)).toBe(3);

    // An ID that is not issued cannot be returned.
    await expect(
      createMovement(f.ctx, {
        facilityId: f.facility.id,
        movementType: "RETURN",
        lines: [line(0, { destinationLocationId: f.locA.id })],
      })
    ).rejects.toMatchObject({ status: 409 });

    // The same ID twice in one movement is refused before anything changes.
    await expect(
      createMovement(f.ctx, {
        facilityId: f.facility.id,
        movementType: "SCRAP",
        lines: [line(0, { sourceLocationId: f.locA.id }), line(0, { sourceLocationId: f.locA.id })],
      })
    ).rejects.toMatchObject({ status: 400 });

    await createMovement(f.ctx, {
      facilityId: f.facility.id,
      movementType: "SCRAP",
      lines: [0, 3].map((i) => line(i, { sourceLocationId: f.locA.id })),
    });
    expect(await statuses()).toEqual(["SCRAPPED", "AVAILABLE", "ISSUED", "SCRAPPED"]);
    expect(await onHand(f.tool.id, f.locA.id)).toBe(1);
    expect(await onHand(f.tool.id, f.locA.id, "SCRAPPED")).toBe(2);
  });

  it("transfers several tool IDs together and reverses them once per tool", async () => {
    const f = await createFixture();
    const department = await createDepartment(f.facility.id);
    const from = await createProject(f.org.id, department.id, "From");
    const to = await createProject(f.org.id, department.id, "To");
    const a = await createTool(f.org.id, { code: "MULTI-A", projectId: from.id });
    const b = await createTool(f.org.id, { code: "MULTI-B", projectId: from.id });
    for (const tool of [a, b]) {
      await createMovement(f.ctx, {
        facilityId: f.facility.id,
        movementType: "RECEIPT",
        grnNumber: "GRN2",
        lines: [{ toolId: tool.id, quantity: 2, destinationLocationId: f.locA.id }],
      });
    }
    const [a1, a2] = await prisma.toolUnit.findMany({ where: { toolId: a.id }, orderBy: { sequence: "asc" } });
    const [b1] = await prisma.toolUnit.findMany({ where: { toolId: b.id }, orderBy: { sequence: "asc" } });
    const lines = [
      { toolId: a.id, quantity: 1, toolUnitId: a1.id, sourceLocationId: f.locA.id },
      { toolId: a.id, quantity: 1, toolUnitId: a2.id, sourceLocationId: f.locA.id },
      { toolId: b.id, quantity: 1, toolUnitId: b1.id, sourceLocationId: f.locA.id },
    ];

    // Several lines without tool IDs are not accepted.
    await expect(
      createMovement(f.ctx, {
        facilityId: f.facility.id,
        movementType: "TRANSFER",
        transferToProjectId: to.id,
        lines: [{ toolId: a.id, quantity: 0 }, { toolId: b.id, quantity: 0 }],
      })
    ).rejects.toMatchObject({ status: 400 });

    const transfer = await createMovement(f.ctx, {
      facilityId: f.facility.id,
      movementType: "TRANSFER",
      transferToProjectId: to.id,
      lines,
    });
    expect(transfer.lines).toHaveLength(3);
    for (const tool of [a, b]) {
      expect((await prisma.tool.findUniqueOrThrow({ where: { id: tool.id } })).projectId).toBe(to.id);
    }

    await reverseMovement(f.ctx, transfer.id);
    for (const tool of [a, b]) {
      expect((await prisma.tool.findUniqueOrThrow({ where: { id: tool.id } })).projectId).toBe(from.id);
    }
  });

  it("takes the storage location from the tool and from where the picked item is", async () => {
    const f = await createFixture();
    const noLocation = createMovement(f.ctx, {
      facilityId: f.facility.id,
      movementType: "RECEIPT", grnNumber: "GRN3",
      lines: [{ toolId: f.tool.id, quantity: 3 }],
    });
    await expect(noLocation).rejects.toMatchObject({ status: 400 });

    await prisma.tool.update({ where: { id: f.tool.id }, data: { defaultLocationId: f.locA.id } });
    await createMovement(f.ctx, {
      facilityId: f.facility.id,
      movementType: "RECEIPT", grnNumber: "GRN3",
      lines: [{ toolId: f.tool.id, quantity: 3 }],
    });
    expect(await onHand(f.tool.id, f.locA.id)).toBe(3);

    const units = await prisma.toolUnit.findMany({ where: { toolId: f.tool.id }, orderBy: { sequence: "asc" } });
    const picked = (i: number) => ({ toolId: f.tool.id, quantity: 1, toolUnitId: units[i].id });
    await createMovement(f.ctx, {
      facilityId: f.facility.id,
      movementType: "ISSUE",
      lines: [picked(0), picked(1)],
    });
    expect(await onHand(f.tool.id, f.locA.id)).toBe(1);

    // A returned item goes back to the tool's own location.
    await createMovement(f.ctx, { facilityId: f.facility.id, movementType: "RETURN", lines: [picked(0)] });
    expect(await onHand(f.tool.id, f.locA.id)).toBe(2);

    // Sharpening goes out from, and comes back to, the place the item is in.
    await createMovement(f.ctx, { facilityId: f.facility.id, movementType: "SHARPEN_DISPATCH", lines: [picked(2)] });
    expect(await onHand(f.tool.id, f.locA.id, "SHARPENING")).toBe(1);
    await createMovement(f.ctx, { facilityId: f.facility.id, movementType: "SHARPEN_RETURN", lines: [picked(2)] });
    expect(await onHand(f.tool.id, f.locA.id, "SHARPENING")).toBe(0);
    expect(await onHand(f.tool.id, f.locA.id)).toBe(2);
  });

  it("failed multi-line movement is atomic", async () => {
    const f = await createFixture();
    await receive(f, 5);
    const failure = createMovement(f.ctx, {
      facilityId: f.facility.id,
      movementType: "ISSUE",
      lines: [
        { toolId: f.tool.id, quantity: 2, sourceLocationId: f.locA.id },
        { toolId: f.tool.id, quantity: 9, sourceLocationId: f.locA.id },
      ],
    });
    await expect(failure).rejects.toBeInstanceOf(AppError);
    expect(await onHand(f.tool.id, f.locA.id)).toBe(5);
  });

  it("rejects non-positive and fractional quantities", async () => {
    const f = await createFixture();
    for (const quantity of [0, -1, 1.5]) {
      await expect(receive(f, quantity)).rejects.toMatchObject({ status: 400 });
    }
  });

  it("requires a reason and a direction for adjustments", async () => {
    const f = await createFixture();
    const noReason = createMovement(f.ctx, {
      facilityId: f.facility.id,
      movementType: "ADJUSTMENT",
      lines: [{ toolId: f.tool.id, quantity: 2, destinationLocationId: f.locA.id, adjustmentDirection: "INCREASE" }],
    });
    await expect(noReason).rejects.toMatchObject({ status: 400 });

    const noDirection = createMovement(f.ctx, {
      facilityId: f.facility.id,
      movementType: "ADJUSTMENT",
      reason: "Cycle count",
      lines: [{ toolId: f.tool.id, quantity: 2, destinationLocationId: f.locA.id }],
    });
    await expect(noDirection).rejects.toMatchObject({ status: 400 });

    const directionOnReceipt = createMovement(f.ctx, {
      facilityId: f.facility.id,
      movementType: "RECEIPT", grnNumber: "GRN1",
      lines: [{ toolId: f.tool.id, quantity: 2, destinationLocationId: f.locA.id, adjustmentDirection: "INCREASE" }],
    });
    await expect(directionOnReceipt).rejects.toMatchObject({ status: 400 });

    await createMovement(f.ctx, {
      facilityId: f.facility.id,
      movementType: "ADJUSTMENT",
      reason: "Cycle count",
      lines: [{ toolId: f.tool.id, quantity: 2, destinationLocationId: f.locA.id, adjustmentDirection: "INCREASE" }],
    });
    expect(await onHand(f.tool.id, f.locA.id)).toBe(2);

    await createMovement(f.ctx, {
      facilityId: f.facility.id,
      movementType: "ADJUSTMENT",
      reason: "Cycle count",
      lines: [{ toolId: f.tool.id, quantity: 1, destinationLocationId: f.locA.id, adjustmentDirection: "DECREASE" }],
    });
    expect(await onHand(f.tool.id, f.locA.id)).toBe(1);
  });

  it("posts several tools in one movement and rolls everything back when one line fails", async () => {
    const f = await createFixture();
    const second = await createTool(f.org.id, { code: `SECOND-${f.tool.id}` });
    const movement = await createMovement(f.ctx, {
      facilityId: f.facility.id,
      movementType: "RECEIPT", grnNumber: "GRN1",
      lines: [
        { toolId: f.tool.id, quantity: 3, destinationLocationId: f.locA.id },
        { toolId: second.id, quantity: 5, destinationLocationId: f.locB.id },
      ],
    });
    expect(movement.lines).toHaveLength(2);
    expect(await onHand(f.tool.id, f.locA.id)).toBe(3);
    expect(await onHand(second.id, f.locB.id)).toBe(5);

    const before = await prisma.inventoryMovement.count({ where: { organizationId: f.org.id } });
    await expect(
      createMovement(f.ctx, {
        facilityId: f.facility.id,
        movementType: "ISSUE",
        lines: [
          { toolId: f.tool.id, quantity: 1, sourceLocationId: f.locA.id },
          { toolId: second.id, quantity: 99, sourceLocationId: f.locB.id },
        ],
      })
    ).rejects.toMatchObject({ status: 409 });
    expect(await onHand(f.tool.id, f.locA.id)).toBe(3);
    expect(await prisma.inventoryMovement.count({ where: { organizationId: f.org.id } })).toBe(before);
  });

  it("scrap and sharpening move units between stock statuses", async () => {
    const f = await createFixture();
    await receive(f, 10);

    await createMovement(f.ctx, {
      facilityId: f.facility.id,
      movementType: "SCRAP",
      reason: "Broken",
      lines: [{ toolId: f.tool.id, quantity: 1, sourceLocationId: f.locA.id }],
    });
    await createMovement(f.ctx, {
      facilityId: f.facility.id,
      movementType: "SHARPEN_DISPATCH",
      lines: [{ toolId: f.tool.id, quantity: 3, sourceLocationId: f.locA.id }],
    });
    expect(await onHand(f.tool.id, f.locA.id, "AVAILABLE")).toBe(6);
    expect(await onHand(f.tool.id, f.locA.id, "SCRAPPED")).toBe(1);
    expect(await onHand(f.tool.id, f.locA.id, "SHARPENING")).toBe(3);

    await createMovement(f.ctx, {
      facilityId: f.facility.id,
      movementType: "SHARPEN_RETURN",
      lines: [{ toolId: f.tool.id, quantity: 2, destinationLocationId: f.locA.id }],
    });
    expect(await onHand(f.tool.id, f.locA.id, "AVAILABLE")).toBe(8);
    expect(await onHand(f.tool.id, f.locA.id, "SHARPENING")).toBe(1);
  });

  it("idempotency key prevents double posting", async () => {
    const f = await createFixture();
    const input = {
      facilityId: f.facility.id,
      movementType: "RECEIPT" as const, grnNumber: "GRN1",
      idempotencyKey: `idem-${f.tool.id}`,
      lines: [{ toolId: f.tool.id, quantity: 4, destinationLocationId: f.locA.id }],
    };
    const first = await createMovement(f.ctx, input);
    const second = await createMovement(f.ctx, input);
    expect(second.id).toBe(first.id);
    expect(await onHand(f.tool.id, f.locA.id)).toBe(4);
  });

  it("enforces permissions per movement type", async () => {
    const f = await createFixture({ permissions: [PERMISSIONS.STOCK_RECEIVE] });
    await receive(f, 5);
    const failure = createMovement(f.ctx, {
      facilityId: f.facility.id,
      movementType: "ISSUE",
      lines: [{ toolId: f.tool.id, quantity: 1, sourceLocationId: f.locA.id }],
    });
    await expect(failure).rejects.toMatchObject({ status: 403 });
  });

  it("enforces facility grants", async () => {
    const f = await createFixture({ grantedFacilityIds: ["some-other-facility"] });
    await expect(receive(f, 1)).rejects.toMatchObject({ status: 403 });
  });

  it("writes an audit event for each posted movement", async () => {
    const f = await createFixture();
    const movement = await receive(f, 2);
    const events = await prisma.auditEvent.findMany({ where: { organizationId: f.org.id } });
    expect(events.some((e) => e.resourceId === movement.id)).toBe(true);
  });

  it("reversal restores stock, marks original REVERSED and rejects a second reversal", async () => {
    const f = await createFixture();
    await receive(f, 10);
    const issue = await createMovement(f.ctx, {
      facilityId: f.facility.id,
      movementType: "ISSUE",
      lines: [{ toolId: f.tool.id, quantity: 4, sourceLocationId: f.locA.id }],
    });
    expect(await onHand(f.tool.id, f.locA.id)).toBe(6);

    await reverseMovement(f.ctx, issue.id);
    expect(await onHand(f.tool.id, f.locA.id)).toBe(10);
    const original = await prisma.inventoryMovement.findUniqueOrThrow({ where: { id: issue.id } });
    expect(original.status).toBe("REVERSED");

    await expect(reverseMovement(f.ctx, issue.id)).rejects.toMatchObject({ status: 409 });
    expect(await onHand(f.tool.id, f.locA.id)).toBe(10);
  });

  it("reversal requires the reverse permission and a reversible type", async () => {
    const f = await createFixture();
    const receipt = await receive(f, 3);
    const limited = { ...f.ctx, permissions: new Set<string>([PERMISSIONS.STOCK_RECEIVE]) };
    await expect(reverseMovement(limited, receipt.id)).rejects.toMatchObject({ status: 403 });

    const scrap = await createMovement(f.ctx, {
      facilityId: f.facility.id,
      movementType: "SCRAP",
      reason: "Broken",
      lines: [{ toolId: f.tool.id, quantity: 1, sourceLocationId: f.locA.id }],
    });
    await expect(reverseMovement(f.ctx, scrap.id)).rejects.toBeInstanceOf(AppError);
  });

  it("lets only one of two concurrent reversals apply", async () => {
    const f = await createFixture();
    await receive(f, 10);
    const issue = await createMovement(f.ctx, {
      facilityId: f.facility.id,
      movementType: "ISSUE",
      lines: [{ toolId: f.tool.id, quantity: 4, sourceLocationId: f.locA.id }],
    });

    const results = await Promise.allSettled([reverseMovement(f.ctx, issue.id), reverseMovement(f.ctx, issue.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await onHand(f.tool.id, f.locA.id)).toBe(10);
    expect(await prisma.inventoryMovement.count({ where: { reversalOfMovementId: issue.id } })).toBe(1);
  });

  it("numbers movements from a sequence without collisions", async () => {
    const f = await createFixture();
    const numbers = await Promise.all([receive(f, 1), receive(f, 1), receive(f, 1)].map((p) => p.then((m) => m.movementNumber)));
    expect(new Set(numbers).size).toBe(3);
    for (const n of numbers) expect(n).toMatch(/^MV-\d{6,}$/);
  });

  it("scopes idempotency keys per user", async () => {
    const f = await createFixture();
    const input = {
      facilityId: f.facility.id,
      movementType: "RECEIPT" as const, grnNumber: "GRN1",
      idempotencyKey: `shared-${f.tool.id}`,
      lines: [{ toolId: f.tool.id, quantity: 1, destinationLocationId: f.locA.id }],
    };
    const mine = await createMovement(f.ctx, input);
    const theirs = await createMovement({ ...f.ctx, userId: (await createMember(f.org.id, `idem-${f.org.id}@t.local`)).id }, input);
    expect(theirs.id).not.toBe(mine.id);
  });
});
