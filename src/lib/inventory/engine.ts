import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { recordAuditEvent } from "@/lib/audit";
import { notifyApprovers, notifyLowStock, notifyUser } from "@/lib/admin/notifications";
import {
  type RequestContext,
  requirePermission,
  assertFacilityAccess,
  assertProjectAccess,
  movementScopeWhere,
  projectIdFilter,
  requireFacilityContext,
  requireOrganizationContext,
  requireToolInScope,
  toolScopeWhere,
} from "@/lib/authz/authorize";
import { PERMISSIONS, type PermissionCode } from "@/lib/authz/permissions";
import { Prisma } from "@prisma/client";
import { createUnits, pickUnits, updateUnits, type UnitStatus } from "@/lib/inventory/units";

export const MOVEMENT_TYPES = [
  "RECEIPT",
  "ISSUE",
  "RETURN",
  "TRANSFER",
  "ADJUSTMENT",
  "SCRAP",
  "SHARPEN_DISPATCH",
  "SHARPEN_RETURN",
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export const ADJUSTMENT_DIRECTIONS = ["INCREASE", "DECREASE"] as const;
export type AdjustmentDirection = (typeof ADJUSTMENT_DIRECTIONS)[number];

export const PENDING_APPROVAL = "PENDING_APPROVAL";

const PERMISSION_BY_MOVEMENT_TYPE: Record<MovementType, PermissionCode> = {
  RECEIPT: PERMISSIONS.STOCK_RECEIVE,
  ISSUE: PERMISSIONS.STOCK_ISSUE,
  RETURN: PERMISSIONS.STOCK_RETURN,
  TRANSFER: PERMISSIONS.STOCK_TRANSFER,
  ADJUSTMENT: PERMISSIONS.STOCK_ADJUST,
  SCRAP: PERMISSIONS.STOCK_ADJUST,
  SHARPEN_DISPATCH: PERMISSIONS.STOCK_ISSUE,
  SHARPEN_RETURN: PERMISSIONS.STOCK_RETURN,
};

export interface MovementLineInput {
  toolId: string;
  quantity: number;
  sourceLocationId?: string | null;
  destinationLocationId?: string | null;
  /** Required for ADJUSTMENT lines (applied at destinationLocationId); forbidden otherwise. */
  adjustmentDirection?: AdjustmentDirection | null;
  /** A specific tool item (e.g. TOO5155-3); allowed for every movement on existing stock, and implies quantity 1. */
  toolUnitId?: string | null;
}

export interface CreateMovementInput {
  facilityId: string;
  movementType: MovementType;
  lines: MovementLineInput[];
  projectId?: string | null;
  machineId?: string | null;
  /** Sharpening dispatch/return only. */
  vendorId?: string | null;
  reason?: string | null;
  remarks?: string | null;
  /** Delivery challan reference; stored for sharpening dispatch/return only. */
  challanNumber?: string | null;
  /** Goods receipt note; required for receipts only. */
  grnNumber?: string | null;
  /** TRANSFER only: the project (in the tool's current department) the tool moves to. */
  transferToProjectId?: string | null;
  idempotencyKey?: string | null;
}

const GRN_TYPES: MovementType[] = ["RECEIPT"];
const SHARPENING_TYPES: MovementType[] = ["SHARPEN_DISPATCH", "SHARPEN_RETURN"];
const SOURCE_LOCATION_TYPES: MovementType[] = ["ISSUE", "SCRAP", "SHARPEN_DISPATCH"];
const DESTINATION_LOCATION_TYPES: MovementType[] = ["RECEIPT", "RETURN", "SHARPEN_RETURN", "ADJUSTMENT"];
// Every movement that acts on existing stock can name the exact tool IDs it moves. Receipts and
// adjustment increases create new units, so there is nothing to pick.
const UNIT_SELECT_TYPES: MovementType[] = [
  "ISSUE",
  "RETURN",
  "TRANSFER",
  "ADJUSTMENT",
  "SCRAP",
  "SHARPEN_DISPATCH",
  "SHARPEN_RETURN",
];

type Tx = Prisma.TransactionClient;

// Other active projects in the tool's own department that the caller may reach. A tool without a
// project (or one outside the caller's scope) has none.
export async function listTransferTargets(ctx: RequestContext, toolId: string) {
  const organizationId = requireOrganizationContext(ctx);
  const facilityId = requireFacilityContext(ctx);

  const tool = await requireToolInScope(ctx, toolId);
  if (!tool.projectId) return { tool, targets: [] };

  const current = await prisma.project.findFirst({
    where: { id: tool.projectId, organizationId, department: { facilityId } },
    select: { departmentId: true },
  });
  if (!current?.departmentId) return { tool, targets: [] };

  const targets = await prisma.project.findMany({
    where: {
      organizationId,
      departmentId: current.departmentId,
      status: "ACTIVE",
      id: { not: tool.projectId, ...(projectIdFilter(ctx) ?? {}) },
    },
    select: { id: true, name: true, code: true },
    orderBy: { name: "asc" },
  });
  return { tool, targets };
}

// Numbers come from a counter incremented inside the business transaction: unique, ordered and
// rolled back with a failed movement. On Postgres this becomes a native SEQUENCE.
async function nextMovementNumber(tx: Tx) {
  const sequence = await tx.sequence.upsert({
    where: { name: "movement" },
    create: { name: "movement", value: 1 },
    update: { value: { increment: 1 } },
  });
  return `MV-${String(sequence.value).padStart(6, "0")}`;
}

async function getOrCreateBalance(
  tx: Tx,
  toolId: string,
  facilityId: string,
  locationId: string,
  stockStatus: string
) {
  const existing = await tx.inventoryBalance.findUnique({
    where: { toolId_locationId_stockStatus: { toolId, locationId, stockStatus } },
  });
  if (existing) return existing;
  return tx.inventoryBalance.create({
    data: { toolId, facilityId, locationId, stockStatus, onHandQuantity: 0, reservedQuantity: 0 },
  });
}

async function applyDelta(
  tx: Tx,
  toolId: string,
  facilityId: string,
  locationId: string,
  stockStatus: string,
  delta: number
) {
  const balance = await getOrCreateBalance(tx, toolId, facilityId, locationId, stockStatus);
  const nextQuantity = balance.onHandQuantity + delta;
  if (nextQuantity < 0) {
    throw AppError.conflict("Insufficient available stock for this operation.", {
      toolId,
      locationId,
      stockStatus,
      available: balance.onHandQuantity,
      requested: -delta,
    });
  }

  // Optimistic concurrency: the update only succeeds if the version matches
  // the value we just read. A mismatch means a concurrent writer beat us.
  const result = await tx.inventoryBalance.updateMany({
    where: { id: balance.id, version: balance.version },
    data: { onHandQuantity: nextQuantity, version: { increment: 1 } },
  });
  if (result.count === 0) {
    throw AppError.conflict(
      "The stock balance was updated concurrently. Please retry the operation."
    );
  }
}

type StoredLine = MovementLineInput;

// Applies the stock effect of a movement. Shared by direct posting and by approval
// of a pending request so both follow identical rules. Balances change per tool/location;
// individual tool units follow, either the one the user picked or the lowest-numbered matches.
async function applyMovementLines(
  tx: Tx,
  facilityId: string,
  movementType: MovementType,
  lines: StoredLine[]
) {
  for (const line of lines) {
    const { toolId, quantity } = line;
    const src = line.sourceLocationId;
    const dst = line.destinationLocationId;
    const delta = (locationId: string, stockStatus: string, amount: number) =>
      applyDelta(tx, toolId, facilityId, locationId, stockStatus, amount);
    const pick = (status: UnitStatus, locationId: string, opts: { backfill?: boolean } = {}) =>
      pickUnits(tx, { toolId, facilityId, status, locationId, count: quantity, unitId: line.toolUnitId, ...opts });

    switch (movementType) {
      case "RECEIPT":
        if (!dst) throw AppError.badRequest("Destination location is required.");
        await delta(dst, "AVAILABLE", quantity);
        await createUnits(tx, { toolId, facilityId, locationId: dst, status: "AVAILABLE", count: quantity });
        break;
      case "RETURN": {
        if (!dst) throw AppError.badRequest("Destination location is required.");
        await delta(dst, "AVAILABLE", quantity);
        const returning = await pickUnits(tx, {
          toolId, facilityId, status: "ISSUED", count: quantity, unitId: line.toolUnitId,
        });
        await updateUnits(tx, returning.map((u) => u.id), { status: "AVAILABLE", locationId: dst });
        await createUnits(tx, {
          toolId, facilityId, locationId: dst, status: "AVAILABLE", count: quantity - returning.length,
        });
        break;
      }
      case "ISSUE": {
        if (!src) throw AppError.badRequest("Source location is required.");
        await delta(src, "AVAILABLE", -quantity);
        const issued = await pick("AVAILABLE", src, { backfill: true });
        await updateUnits(tx, issued.map((u) => u.id), { status: "ISSUED", locationId: null });
        break;
      }
      case "TRANSFER":
        // A transfer moves the tool between projects (handled when the movement is created or
        // reversed); it does not change stock balances. A chosen unit must be on hand at the source.
        if (line.toolUnitId && src) await pick("AVAILABLE", src);
        break;
      case "ADJUSTMENT": {
        if (!dst) throw AppError.badRequest("Location is required for adjustments.");
        if (line.adjustmentDirection !== "INCREASE" && line.adjustmentDirection !== "DECREASE") {
          throw AppError.badRequest("Adjustment direction (increase or decrease) is required.");
        }
        if (line.adjustmentDirection === "DECREASE") {
          await delta(dst, "AVAILABLE", -quantity);
          const removed = await pick("AVAILABLE", dst, { backfill: true });
          await updateUnits(tx, removed.map((u) => u.id), { status: "REMOVED", locationId: null });
        } else {
          await delta(dst, "AVAILABLE", quantity);
          await createUnits(tx, { toolId, facilityId, locationId: dst, status: "AVAILABLE", count: quantity });
        }
        break;
      }
      case "SCRAP": {
        if (!src) throw AppError.badRequest("Location is required.");
        await delta(src, "AVAILABLE", -quantity);
        await delta(src, "SCRAPPED", quantity);
        const scrapped = await pick("AVAILABLE", src, { backfill: true });
        await updateUnits(tx, scrapped.map((u) => u.id), { status: "SCRAPPED" });
        break;
      }
      case "SHARPEN_DISPATCH": {
        if (!src) throw AppError.badRequest("Location is required.");
        await delta(src, "AVAILABLE", -quantity);
        await delta(src, "SHARPENING", quantity);
        const dispatched = await pick("AVAILABLE", src, { backfill: true });
        await updateUnits(tx, dispatched.map((u) => u.id), { status: "SHARPENING" });
        break;
      }
      case "SHARPEN_RETURN": {
        if (!dst) throw AppError.badRequest("Destination location is required.");
        await delta(dst, "SHARPENING", -quantity);
        await delta(dst, "AVAILABLE", quantity);
        const back = await pick("SHARPENING", dst, { backfill: true });
        await updateUnits(tx, back.map((u) => u.id), { status: "AVAILABLE" });
        break;
      }
    }
  }
}

// Fills in the storage location each line needs when the caller did not name one. An explicitly
// given location is left alone. Transfers move a tool between parts, so they only need the source
// of a picked item.
function resolveLineLocations(
  movementType: MovementType,
  lines: MovementLineInput[],
  tools: { id: string; code: string; defaultLocationId: string | null }[],
  units: { id: string; locationId: string | null }[]
): MovementLineInput[] {
  const toolById = new Map(tools.map((t) => [t.id, t]));
  const unitById = new Map(units.map((u) => [u.id, u]));

  return lines.map((line, index) => {
    const tool = toolById.get(line.toolId);
    const unitLocation = line.toolUnitId ? unitById.get(line.toolUnitId)?.locationId ?? null : null;
    const fallback = tool?.defaultLocationId ?? null;
    const resolved = { ...line };

    const needsSource = SOURCE_LOCATION_TYPES.includes(movementType) || (movementType === "TRANSFER" && Boolean(line.toolUnitId));
    const needsDestination = DESTINATION_LOCATION_TYPES.includes(movementType);
    if (needsSource && !resolved.sourceLocationId) resolved.sourceLocationId = unitLocation ?? fallback;
    if (needsDestination && !resolved.destinationLocationId) {
      // An issued item sits in no location; it goes back to its tool's own.
      resolved.destinationLocationId = movementType === "RETURN" ? fallback : unitLocation ?? fallback;
    }

    const missing = (needsSource && !resolved.sourceLocationId) || (needsDestination && !resolved.destinationLocationId);
    if (missing) {
      throw AppError.badRequest(
        `Line ${index + 1}: ${tool?.code ?? "the tool"} has no storage location. Set one on the tool first.`
      );
    }
    return resolved;
  });
}

// Fails fast with a precise message before any transaction opens.
function validateLines(movementType: MovementType, lines: MovementLineInput[]) {
  const seenUnits = new Set<string>();
  lines.forEach((line, index) => {
    const label = `Line ${index + 1}`;
    if (line.toolUnitId && !UNIT_SELECT_TYPES.includes(movementType)) {
      throw AppError.badRequest(`${label}: a specific tool ID cannot be chosen for this type of movement.`);
    }
    if (line.toolUnitId) {
      if (seenUnits.has(line.toolUnitId)) throw AppError.badRequest(`${label}: this tool ID is already on another line.`);
      seenUnits.add(line.toolUnitId);
      if (movementType === "ADJUSTMENT" && line.adjustmentDirection !== "DECREASE") {
        throw AppError.badRequest(`${label}: a tool ID can only be chosen when decreasing stock.`);
      }
    }
    if (movementType === "TRANSFER") {
      if (line.destinationLocationId) {
        throw AppError.badRequest(`${label}: transfers move a tool between parts, not locations.`);
      }
      if (line.adjustmentDirection) {
        throw AppError.badRequest(`${label}: adjustment direction only applies to adjustments.`);
      }
      return;
    }
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw AppError.badRequest(`${label}: quantity must be a positive whole number.`);
    }
    if (movementType === "ADJUSTMENT") {
      if (line.sourceLocationId) throw AppError.badRequest(`${label}: adjustments use a single location.`);
      if (!line.adjustmentDirection || !ADJUSTMENT_DIRECTIONS.includes(line.adjustmentDirection)) {
        throw AppError.badRequest(`${label}: choose whether the adjustment increases or decreases stock.`);
      }
    } else if (line.adjustmentDirection) {
      throw AppError.badRequest(`${label}: adjustment direction only applies to adjustments.`);
    }
  });
}

// Adjustments from users who cannot approve them are held until an approver decides.
function requiresApproval(ctx: RequestContext, movementType: MovementType) {
  return movementType === "ADJUSTMENT" && !ctx.permissions.has(PERMISSIONS.STOCK_ADJUST_APPROVE);
}

// Idempotency keys are namespaced per user so one tenant can never observe another's movement.
function scopedIdempotencyKey(ctx: RequestContext, key?: string | null) {
  return key ? `${ctx.userId}:${key}` : null;
}

export async function createMovement(ctx: RequestContext, rawInput: CreateMovementInput) {
  // Picking a specific tool item means exactly one item, whatever quantity the client sent.
  const input: CreateMovementInput = {
    ...rawInput,
    lines: rawInput.lines.map((l) => (l.toolUnitId ? { ...l, quantity: 1 } : l)),
  };
  const permission = PERMISSION_BY_MOVEMENT_TYPE[input.movementType];
  requirePermission(ctx, permission);
  assertFacilityAccess(ctx, input.facilityId);
  assertProjectAccess(ctx, input.projectId);

  if (!ctx.organizationId) throw AppError.badRequest("No organization context selected.");
  if (!input.lines.length) throw AppError.badRequest("At least one tool line is required.");

  validateLines(input.movementType, input.lines);
  if (input.movementType === "ADJUSTMENT" && !input.reason?.trim()) {
    throw AppError.badRequest("A reason is required for stock adjustments.");
  }
  const isSharpening = SHARPENING_TYPES.includes(input.movementType);
  const grnNumber = GRN_TYPES.includes(input.movementType) ? input.grnNumber?.trim() || null : null;
  if (GRN_TYPES.includes(input.movementType)) {
    if (!grnNumber) throw AppError.badRequest("GRN No. is required.");
    if (!/^[A-Za-z0-9]+$/.test(grnNumber)) throw AppError.badRequest("GRN No. may contain only letters and digits.");
  }
  if (input.movementType === "TRANSFER") {
    if (input.lines.length > 1 && input.lines.some((l) => !l.toolUnitId)) {
      throw AppError.badRequest("Choose the tool IDs to transfer.");
    }
    if (!input.transferToProjectId) throw AppError.badRequest("Choose the part to transfer the tool to.");
  }

  // Idempotency: replaying a request with the same key returns the original result.
  const idempotencyKey = scopedIdempotencyKey(ctx, input.idempotencyKey);
  if (idempotencyKey) {
    const existing = await prisma.inventoryMovement.findUnique({
      where: { idempotencyKey },
      include: { lines: true },
    });
    if (existing) return existing;
  }

  const facility = await prisma.facility.findFirst({
    where: { id: input.facilityId, organizationId: ctx.organizationId },
  });
  if (!facility) throw AppError.notFound("Plant not found.");

  if (input.projectId) {
    const project = await prisma.project.findFirst({
      where: { id: input.projectId, organizationId: ctx.organizationId, department: { facilityId: input.facilityId } },
      select: { id: true },
    });
    if (!project) throw AppError.badRequest("Part is not valid for this plant.");
  }

  // Tools must be inside the caller's scope, exactly as on the dashboard.
  const toolIds = [...new Set(input.lines.map((l) => l.toolId))];
  const tools = await prisma.tool.findMany({
    where: {
      AND: [
        { id: { in: toolIds }, organizationId: ctx.organizationId },
        toolScopeWhere(ctx, input.facilityId, { includeUnassigned: true }),
      ],
    },
    select: { id: true, code: true, defaultLocationId: true },
  });
  if (tools.length !== toolIds.length) {
    throw AppError.badRequest("One or more tools were not found in your current workspace.");
  }

  // Storage locations are never chosen per movement: they come from the tool (set when it was
  // created) or from where the picked item currently is.
  const pickedUnitIds = input.lines.map((l) => l.toolUnitId).filter(Boolean) as string[];
  const pickedUnits = pickedUnitIds.length
    ? await prisma.toolUnit.findMany({
        where: { id: { in: pickedUnitIds }, facilityId: input.facilityId },
        select: { id: true, locationId: true },
      })
    : [];
  input.lines = resolveLineLocations(input.movementType, input.lines, tools, pickedUnits);

  const locationIds = [
    ...new Set(
      input.lines.flatMap((l) => [l.sourceLocationId, l.destinationLocationId]).filter(Boolean)
    ),
  ] as string[];
  const locations = await prisma.storageLocation.findMany({
    where: { id: { in: locationIds }, facilityId: input.facilityId },
  });
  if (locations.length !== locationIds.length) {
    throw AppError.badRequest("One or more storage locations are invalid for this plant.");
  }

  let vendorId: string | null = null;
  if (isSharpening && input.vendorId) {
    const vendor = await prisma.vendor.findFirst({
      where: { id: input.vendorId, facilityId: input.facilityId, status: "ACTIVE" },
      select: { id: true },
    });
    if (!vendor) throw AppError.badRequest("Vendor is not valid for this plant.");
    vendorId = vendor.id;
  }

  // A transfer reassigns the tools behind the chosen IDs to another project of their own
  // department. Tools whose IDs were picked record one item per line; a line with no ID records the
  // tool's whole stock.
  let transfer: { fromProjectId: string; toProjectId: string; toolIds: string[]; stockByTool: Map<string, number> } | null = null;
  if (input.movementType === "TRANSFER") {
    let fromProjectId: string | null = null;
    const stockByTool = new Map<string, number>();
    for (const toolId of toolIds) {
      const { tool, targets } = await listTransferTargets(ctx, toolId);
      if (!tool.projectId || !targets.some((t) => t.id === input.transferToProjectId)) {
        throw AppError.badRequest(`${tool.code} cannot be transferred to that part.`);
      }
      if (fromProjectId && fromProjectId !== tool.projectId) {
        throw AppError.badRequest("The selected tools belong to different parts. Transfer them separately.");
      }
      fromProjectId = tool.projectId;
      const balances = await prisma.inventoryBalance.findMany({
        where: { toolId: tool.id, facilityId: input.facilityId, stockStatus: { not: "SCRAPPED" } },
        select: { onHandQuantity: true },
      });
      stockByTool.set(tool.id, balances.reduce((total, b) => total + b.onHandQuantity, 0));
    }
    transfer = { fromProjectId: fromProjectId!, toProjectId: input.transferToProjectId!, toolIds, stockByTool };
  }

  const pending = requiresApproval(ctx, input.movementType);

  let movement;
  try {
    movement = await prisma.$transaction(async (tx) => {
      // Taking the counter first acquires the write lock before any stock is read.
      const movementNumber = await nextMovementNumber(tx);
      if (!pending) await applyMovementLines(tx, input.facilityId, input.movementType, input.lines);
      if (transfer) {
        for (const toolId of transfer.toolIds) {
          const moved = await tx.tool.updateMany({
            where: { id: toolId, projectId: transfer.fromProjectId },
            data: { projectId: transfer.toProjectId, updatedById: ctx.userId, version: { increment: 1 } },
          });
          if (moved.count === 0) {
            throw AppError.conflict("The tool was moved or changed concurrently. Please retry the transfer.");
          }
        }
      }

      const created = await tx.inventoryMovement.create({
        data: {
          organizationId: ctx.organizationId!,
          facilityId: input.facilityId,
          movementNumber,
          movementType: input.movementType,
          status: pending ? PENDING_APPROVAL : "POSTED",
          projectId: input.projectId ?? null,
          // Receipts (GRN) and sharpening (vendor) do not use a machine.
          machineId:
            input.movementType === "RECEIPT" || input.movementType === "TRANSFER" || isSharpening
              ? null
              : input.machineId ?? null,
          vendorId,
          actorId: ctx.userId,
          reason: input.reason ?? null,
          remarks: input.remarks ?? null,
          challanNumber: isSharpening ? input.challanNumber?.trim() || null : null,
          grnNumber,
          transferFromProjectId: transfer?.fromProjectId ?? null,
          transferToProjectId: transfer?.toProjectId ?? null,
          idempotencyKey,
          postedAt: pending ? null : new Date(),
          lines: {
            create: input.lines.map((l) => ({
              toolId: l.toolId,
              quantity: transfer && !l.toolUnitId ? transfer.stockByTool.get(l.toolId) ?? 0 : l.quantity,
              sourceLocationId: l.sourceLocationId ?? null,
              destinationLocationId: l.destinationLocationId ?? null,
              adjustmentDirection: l.adjustmentDirection ?? null,
              toolUnitId: l.toolUnitId ?? null,
            })),
          },
        },
        include: { lines: true },
      });

      await recordAuditEvent(
        {
          organizationId: ctx.organizationId,
          actorId: ctx.userId,
          action: pending ? "movement.adjustment_requested" : `movement.${input.movementType.toLowerCase()}`,
          resourceType: "InventoryMovement",
          resourceId: created.id,
          metadata: { movementNumber: created.movementNumber, lineCount: created.lines.length },
        },
        tx
      );
      return created;
    });
  } catch (error) {
    // Two concurrent submissions with the same key: the loser returns the winner's movement.
    if (idempotencyKey && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await prisma.inventoryMovement.findUnique({ where: { idempotencyKey }, include: { lines: true } });
      if (existing) return existing;
    }
    throw error;
  }

  // Notifications are best-effort and never undo a committed movement.
  if (pending) {
    await notifyApprovers(ctx.organizationId, input.facilityId, ctx.userId, {
      type: "APPROVAL_REQUESTED",
      title: `Approval needed: ${movement.movementNumber}`,
      message: `A stock adjustment is waiting for approval. Reason: ${input.reason}`,
    });
  } else {
    await notifyLowStock(ctx.organizationId, input.facilityId, toolIds);
  }

  return movement;
}

// Loads a movement only when it sits in the caller's facility and workspace scope.
async function loadScopedMovement(ctx: RequestContext, movementId: string) {
  if (!ctx.organizationId) throw AppError.badRequest("No organization context selected.");
  const base = await prisma.inventoryMovement.findFirst({
    where: { id: movementId, organizationId: ctx.organizationId },
    select: { facilityId: true },
  });
  if (!base) throw AppError.notFound("Movement not found.");
  assertFacilityAccess(ctx, base.facilityId);

  const movement = await prisma.inventoryMovement.findFirst({
    where: { id: movementId, organizationId: ctx.organizationId, ...movementScopeWhere(ctx, base.facilityId) },
    include: { lines: true },
  });
  if (!movement) throw AppError.notFound("Movement not found.");
  return movement;
}

async function loadPendingMovement(ctx: RequestContext, movementId: string) {
  requirePermission(ctx, PERMISSIONS.STOCK_ADJUST_APPROVE);
  const movement = await loadScopedMovement(ctx, movementId);
  if (movement.status !== PENDING_APPROVAL) {
    throw AppError.conflict("This request is no longer awaiting approval.");
  }
  return movement;
}

export async function approveMovement(ctx: RequestContext, movementId: string) {
  const pending = await loadPendingMovement(ctx, movementId);
  if (pending.actorId === ctx.userId) {
    throw AppError.forbidden("You cannot approve your own request.");
  }

  const posted = await prisma.$transaction(async (tx) => {
    // Claiming the pending state first stops two approvers from both applying it.
    const claimed = await tx.inventoryMovement.updateMany({
      where: { id: pending.id, status: PENDING_APPROVAL },
      data: { status: "POSTED", postedAt: new Date() },
    });
    if (claimed.count === 0) throw AppError.conflict("This request has already been decided.");

    await applyMovementLines(tx, pending.facilityId, pending.movementType as MovementType, pending.lines as StoredLine[]);
    await tx.approval.create({
      data: { movementId: pending.id, approverId: ctx.userId, status: "APPROVED", decidedAt: new Date() },
    });
    await recordAuditEvent(
      {
        organizationId: pending.organizationId,
        actorId: ctx.userId,
        action: "movement.adjustment_approved",
        resourceType: "InventoryMovement",
        resourceId: pending.id,
        metadata: { movementNumber: pending.movementNumber, requestedBy: pending.actorId },
      },
      tx
    );
    return tx.inventoryMovement.findUniqueOrThrow({ where: { id: pending.id }, include: { lines: true } });
  });

  await notifyUser(pending.actorId, {
    type: "APPROVAL_APPROVED",
    title: `Approved: ${pending.movementNumber}`,
    message: "Your stock adjustment was approved and posted.",
  });
  await notifyLowStock(pending.organizationId, pending.facilityId, pending.lines.map((l) => l.toolId));

  return posted;
}

export async function rejectMovement(ctx: RequestContext, movementId: string, reason: string) {
  const pending = await loadPendingMovement(ctx, movementId);
  if (!reason.trim()) throw AppError.badRequest("A reason is required to reject a request.");

  const rejected = await prisma.$transaction(async (tx) => {
    const claimed = await tx.inventoryMovement.updateMany({
      where: { id: pending.id, status: PENDING_APPROVAL },
      data: { status: "CANCELLED" },
    });
    if (claimed.count === 0) throw AppError.conflict("This request has already been decided.");

    await tx.approval.create({
      data: {
        movementId: pending.id,
        approverId: ctx.userId,
        status: "REJECTED",
        reason: reason.trim(),
        decidedAt: new Date(),
      },
    });
    await recordAuditEvent(
      {
        organizationId: pending.organizationId,
        actorId: ctx.userId,
        action: "movement.adjustment_rejected",
        resourceType: "InventoryMovement",
        resourceId: pending.id,
        metadata: { movementNumber: pending.movementNumber, requestedBy: pending.actorId, reason: reason.trim() },
      },
      tx
    );
    return tx.inventoryMovement.findUniqueOrThrow({ where: { id: pending.id }, include: { lines: true } });
  });

  await notifyUser(pending.actorId, {
    type: "APPROVAL_REJECTED",
    title: `Rejected: ${pending.movementNumber}`,
    message: `Your stock adjustment was rejected. Reason: ${reason.trim()}`,
  });

  return rejected;
}

export const REVERSIBLE_TYPES: MovementType[] = ["ISSUE", "RECEIPT", "RETURN", "TRANSFER"];

export async function reverseMovement(ctx: RequestContext, movementId: string) {
  requirePermission(ctx, PERMISSIONS.MOVEMENT_REVERSE);

  const original = await loadScopedMovement(ctx, movementId);
  if (original.status === "REVERSED") {
    throw AppError.conflict("This movement has already been reversed.");
  }
  if (original.status !== "POSTED") {
    throw AppError.conflict("Only posted movements can be reversed.");
  }
  if (!REVERSIBLE_TYPES.includes(original.movementType as MovementType)) {
    throw AppError.badRequest(`Movements of type ${original.movementType} cannot be reversed.`);
  }

  // The reversal swaps source/destination on every line and is itself a new,
  // fully audited movement — the original record is never mutated or deleted.
  const reversal = await prisma.$transaction(async (tx) => {
    // Claim the original first: of two concurrent reversals exactly one gets count 1 and the
    // other fails before touching stock, so stock can never be restored twice.
    const claimed = await tx.inventoryMovement.updateMany({
      where: { id: original.id, status: "POSTED" },
      data: { status: "REVERSED" },
    });
    if (claimed.count === 0) throw AppError.conflict("This movement has already been reversed.");

    const movementNumber = await nextMovementNumber(tx);
    const movedBack = new Set<string>();
    for (const line of original.lines) {
      const unitCtx = { toolId: line.toolId, facilityId: original.facilityId, count: line.quantity };
      if (original.movementType === "ISSUE") {
        await applyDelta(tx, line.toolId, original.facilityId, line.sourceLocationId!, "AVAILABLE", line.quantity);
        const back = await pickUnits(tx, { ...unitCtx, status: "ISSUED", unitId: line.toolUnitId });
        await updateUnits(tx, back.map((u) => u.id), { status: "AVAILABLE", locationId: line.sourceLocationId });
        await createUnits(tx, {
          ...unitCtx, locationId: line.sourceLocationId ?? null, status: "AVAILABLE", count: line.quantity - back.length,
        });
      } else if (original.movementType === "RECEIPT" || original.movementType === "RETURN") {
        await applyDelta(tx, line.toolId, original.facilityId, line.destinationLocationId!, "AVAILABLE", -line.quantity);
        const leaving = await pickUnits(tx, {
          ...unitCtx, status: "AVAILABLE", locationId: line.destinationLocationId, backfill: true, newestFirst: true,
          unitId: original.movementType === "RETURN" ? line.toolUnitId : null,
        });
        await updateUnits(
          tx,
          leaving.map((u) => u.id),
          original.movementType === "RECEIPT" ? { status: "REMOVED", locationId: null } : { status: "ISSUED", locationId: null }
        );
      } else if (original.movementType === "TRANSFER") {
        if (original.transferFromProjectId && original.transferToProjectId) {
          // Several lines can belong to one tool; it only moves back once.
          if (movedBack.has(line.toolId)) continue;
          movedBack.add(line.toolId);
          const moved = await tx.tool.updateMany({
            where: { id: line.toolId, projectId: original.transferToProjectId },
            data: { projectId: original.transferFromProjectId, updatedById: ctx.userId, version: { increment: 1 } },
          });
          if (moved.count === 0) {
            throw AppError.conflict("The tool is no longer in the part it was transferred to, so this cannot be reversed.");
          }
        } else {
          // Legacy location-to-location transfer.
          await applyDelta(tx, line.toolId, original.facilityId, line.destinationLocationId!, "AVAILABLE", -line.quantity);
          await applyDelta(tx, line.toolId, original.facilityId, line.sourceLocationId!, "AVAILABLE", line.quantity);
          const moving = await pickUnits(tx, {
            ...unitCtx, status: "AVAILABLE", locationId: line.destinationLocationId, backfill: true,
          });
          await updateUnits(tx, moving.map((u) => u.id), { locationId: line.sourceLocationId });
        }
      }
    }

    const created = await tx.inventoryMovement.create({
      data: {
        organizationId: original.organizationId,
        facilityId: original.facilityId,
        movementNumber,
        movementType: "REVERSAL",
        status: "POSTED",
        projectId: original.projectId,
        machineId: original.machineId,
        vendorId: original.vendorId,
        transferFromProjectId: original.transferToProjectId,
        transferToProjectId: original.transferFromProjectId,
        actorId: ctx.userId,
        reason: `Reversal of ${original.movementNumber}`,
        reversalOfMovementId: original.id,
        postedAt: new Date(),
        lines: {
          create: original.lines.map((l) => ({
            toolId: l.toolId,
            quantity: l.quantity,
            sourceLocationId: l.destinationLocationId,
            destinationLocationId: l.sourceLocationId,
            toolUnitId: l.toolUnitId,
          })),
        },
      },
      include: { lines: true },
    });

    await recordAuditEvent(
      {
        organizationId: ctx.organizationId,
        actorId: ctx.userId,
        action: "movement.reverse",
        resourceType: "InventoryMovement",
        resourceId: created.id,
        metadata: { reversalOf: original.movementNumber },
      },
      tx
    );
    return created;
  });

  await notifyLowStock(
    original.organizationId,
    original.facilityId,
    original.lines.map((l) => l.toolId)
  );

  return reversal;
}
