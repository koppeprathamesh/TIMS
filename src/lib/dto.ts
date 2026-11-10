import type { Prisma } from "@prisma/client";

// Response shapes expose only what the UI needs. Internal ids (organization, creators, raw
// foreign keys) and bookkeeping columns never leave the server.

type ToolWithRelations = Prisma.ToolGetPayload<{
  include: { defaultLocation: true; project: { select: { id: true; name: true; code: true } } };
}>;

export function toToolDetailDto(
  tool: ToolWithRelations,
  stock: { available: number; sharpening: number; scrapped: number }
) {
  return {
    id: tool.id,
    code: tool.code,
    name: tool.name,
    drawingNumber: tool.drawingNumber,
    specNumber: tool.specNumber,
    description: tool.description,
    minimumQuantity: tool.minimumQuantity,
    totalStockCapacity: tool.totalStockCapacity,
    unitOfMeasure: tool.unitOfMeasure,
    status: tool.status,
    version: tool.version,
    defaultLocationId: tool.defaultLocationId,
    defaultLocation: tool.defaultLocation
      ? { id: tool.defaultLocation.id, name: tool.defaultLocation.name, code: tool.defaultLocation.code }
      : null,
    project: tool.project,
    availableQuantity: stock.available,
    sharpeningQuantity: stock.sharpening,
    scrappedQuantity: stock.scrapped,
  };
}

export function toToolSummaryDto(tool: { id: string; code: string; name: string; status: string; version: number }) {
  return { id: tool.id, code: tool.code, name: tool.name, status: tool.status, version: tool.version };
}

type MovementWithRelations = Prisma.InventoryMovementGetPayload<{
  include: {
    lines: { include: { tool: true; toolUnit: { select: { serialNumber: true } }; sourceLocation: true; destinationLocation: true } };
    actor: { select: { displayName: true } };
    project: { select: { name: true } };
    machine: { select: { name: true } };
    vendor: { select: { name: true } };
    transferFromProject: { select: { name: true } };
    transferToProject: { select: { name: true } };
  };
}>;

export function toMovementDto(movement: MovementWithRelations) {
  return {
    id: movement.id,
    movementNumber: movement.movementNumber,
    movementType: movement.movementType,
    status: movement.status,
    reason: movement.reason,
    remarks: movement.remarks,
    challanNumber: movement.challanNumber,
    grnNumber: movement.grnNumber,
    occurredAt: movement.occurredAt,
    actor: { displayName: movement.actor.displayName },
    project: movement.project ? { name: movement.project.name } : null,
    machine: movement.machine ? { name: movement.machine.name } : null,
    vendor: movement.vendor ? { name: movement.vendor.name } : null,
    transferFromProject: movement.transferFromProject ? { name: movement.transferFromProject.name } : null,
    transferToProject: movement.transferToProject ? { name: movement.transferToProject.name } : null,
    lines: movement.lines.map((line) => ({
      id: line.id,
      quantity: line.quantity,
      adjustmentDirection: line.adjustmentDirection,
      tool: { id: line.tool.id, code: line.tool.code, name: line.tool.name },
      toolUnit: line.toolUnit ? { serialNumber: line.toolUnit.serialNumber } : null,
      sourceLocation: line.sourceLocation ? { name: line.sourceLocation.name, code: line.sourceLocation.code } : null,
      destinationLocation: line.destinationLocation
        ? { name: line.destinationLocation.name, code: line.destinationLocation.code }
        : null,
    })),
  };
}

// Result of posting a movement: enough for a confirmation message, nothing more.
export function toMovementReceiptDto(movement: { id: string; movementNumber: string; movementType: string; status: string }) {
  return {
    id: movement.id,
    movementNumber: movement.movementNumber,
    movementType: movement.movementType,
    status: movement.status,
  };
}
