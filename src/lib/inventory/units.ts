import type { Prisma } from "@prisma/client";
import { AppError } from "@/lib/errors";

type Tx = Prisma.TransactionClient;

export type UnitStatus = "AVAILABLE" | "SHARPENING" | "ISSUED" | "SCRAPPED" | "REMOVED";

// Creates `count` new units numbered after the tool's highest existing one (TOO5155-1, TOO5155-2 …).
export async function createUnits(
  tx: Tx,
  input: { toolId: string; facilityId: string; locationId: string | null; status: UnitStatus; count: number }
) {
  if (input.count <= 0) return [];
  const tool = await tx.tool.findUniqueOrThrow({ where: { id: input.toolId }, select: { code: true } });
  const last = await tx.toolUnit.aggregate({ where: { toolId: input.toolId }, _max: { sequence: true } });
  let sequence = last._max.sequence ?? 0;

  const units = [];
  for (let i = 0; i < input.count; i++) {
    sequence += 1;
    units.push(
      await tx.toolUnit.create({
        data: {
          toolId: input.toolId,
          sequence,
          serialNumber: `${tool.code}-${sequence}`,
          facilityId: input.facilityId,
          locationId: input.locationId,
          status: input.status,
        },
      })
    );
  }
  return units;
}

// Finds the units a movement acts on. A specific `unitId` must match the expected status and
// location exactly. Otherwise the lowest-numbered matching units are taken; with `backfill`, any
// shortfall is created on the spot so stock that predates unit tracking is still movable.
export async function pickUnits(
  tx: Tx,
  input: {
    toolId: string;
    facilityId: string;
    status: UnitStatus;
    locationId?: string | null;
    count: number;
    unitId?: string | null;
    backfill?: boolean;
    newestFirst?: boolean;
  }
) {
  if (input.unitId) {
    const unit = await tx.toolUnit.findUnique({ where: { id: input.unitId } });
    if (!unit || unit.toolId !== input.toolId || unit.facilityId !== input.facilityId) {
      throw AppError.badRequest("The selected tool ID does not belong to this tool.");
    }
    if (unit.status !== input.status || (input.locationId && unit.locationId !== input.locationId)) {
      throw AppError.conflict(`${unit.serialNumber} is not ${input.status.toLowerCase()} at the selected location.`);
    }
    return [unit];
  }

  const found = await tx.toolUnit.findMany({
    where: {
      toolId: input.toolId,
      facilityId: input.facilityId,
      status: input.status,
      ...(input.locationId ? { locationId: input.locationId } : {}),
    },
    orderBy: { sequence: input.newestFirst ? "desc" : "asc" },
    take: input.count,
  });
  const missing = input.count - found.length;
  if (missing > 0 && input.backfill) {
    found.push(
      ...(await createUnits(tx, {
        toolId: input.toolId,
        facilityId: input.facilityId,
        locationId: input.locationId ?? null,
        status: input.status,
        count: missing,
      }))
    );
  }
  return found;
}

export async function updateUnits(
  tx: Tx,
  unitIds: string[],
  data: { status?: UnitStatus; locationId?: string | null }
) {
  if (!unitIds.length) return;
  await tx.toolUnit.updateMany({ where: { id: { in: unitIds } }, data });
}

// Stock that existed before unit tracking has balances but no units; give it units so it can be
// picked by ID. Only fills gaps, never removes anything. Without a locationId every location is covered.
export async function backfillUnits(
  tx: Tx,
  input: { facilityId: string; locationId?: string; status: "AVAILABLE" | "SHARPENING"; toolId?: string }
) {
  const balances = await tx.inventoryBalance.findMany({
    where: {
      facilityId: input.facilityId,
      ...(input.locationId ? { locationId: input.locationId } : {}),
      stockStatus: input.status,
      onHandQuantity: { gt: 0 },
      ...(input.toolId ? { toolId: input.toolId } : {}),
    },
    select: { toolId: true, locationId: true, onHandQuantity: true },
  });
  for (const balance of balances) {
    const existing = await tx.toolUnit.count({
      where: { toolId: balance.toolId, locationId: balance.locationId, status: input.status },
    });
    if (existing < balance.onHandQuantity) {
      await createUnits(tx, {
        toolId: balance.toolId,
        facilityId: input.facilityId,
        locationId: balance.locationId,
        status: input.status,
        count: balance.onHandQuantity - existing,
      });
    }
  }
}
