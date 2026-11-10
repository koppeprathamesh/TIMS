import { z } from "zod";
import { ADJUSTMENT_DIRECTIONS, MOVEMENT_TYPES } from "@/lib/inventory/engine";

export const movementLineSchema = z.object({
  toolId: z.string().min(1),
  // Transfers carry no quantity from the client; the engine records the tool's stock itself.
  quantity: z.coerce.number().int().min(0).default(0),
  sourceLocationId: z.string().min(1).optional().nullable(),
  destinationLocationId: z.string().min(1).optional().nullable(),
  // Required for ADJUSTMENT lines; the engine rejects it on every other type.
  adjustmentDirection: z.enum(ADJUSTMENT_DIRECTIONS).optional().nullable(),
  // A specific tool item (e.g. TOO5155-3) for issue, transfer and sharpening lines.
  toolUnitId: z.string().min(1).optional().nullable(),
});

export const createMovementSchema = z.object({
  movementType: z.enum(MOVEMENT_TYPES),
  lines: z.array(movementLineSchema).min(1, "At least one tool line is required.").max(100, "At most 100 lines per movement."),
  projectId: z.string().min(1).optional().nullable(),
  machineId: z.string().min(1).optional().nullable(),
  vendorId: z.string().min(1).optional().nullable(),
  reason: z.string().trim().max(500).optional().nullable(),
  remarks: z.string().trim().max(2000).optional().nullable(),
  challanNumber: z.string().trim().max(50).optional().nullable(),
  grnNumber: z.string().trim().max(50).optional().nullable(),
  transferToProjectId: z.string().min(1).optional().nullable(),
  idempotencyKey: z.string().min(1).optional().nullable(),
});
