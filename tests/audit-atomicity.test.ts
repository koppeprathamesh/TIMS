import { describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { createMovement } from "@/lib/inventory/engine";
import { createFixture, onHand } from "./helpers";

vi.mock("@/lib/audit", () => ({
  recordAuditEvent: vi.fn().mockRejectedValue(new Error("audit down")),
}));

// The audit row is written inside the business transaction, so a failing audit insert must undo
// the stock change instead of returning an error after the stock already moved.
describe("audit atomicity", () => {
  it("rolls the whole movement back when the audit write fails", async () => {
    const f = await createFixture();
    await expect(
      createMovement(f.ctx, {
        facilityId: f.facility.id,
        movementType: "RECEIPT", grnNumber: "GRN1",
        lines: [{ toolId: f.tool.id, quantity: 5, destinationLocationId: f.locA.id }],
      })
    ).rejects.toThrow("audit down");

    expect(await onHand(f.tool.id, f.locA.id)).toBe(0);
    expect(await prisma.inventoryMovement.count({ where: { organizationId: f.org.id } })).toBe(0);
  });
});
