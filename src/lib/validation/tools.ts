import { z } from "zod";

export const toolStatusValues = ["ACTIVE", "INACTIVE"] as const;

export const createToolSchema = z.object({
  code: z.string().trim().min(1, "Tool code is required.").max(50),
  name: z.string().trim().min(1, "Tool name is required.").max(200),
  // Tools are scoped to a project; when omitted the active project context is used.
  projectId: z.string().min(1).optional().nullable(),
  drawingNumber: z.string().trim().max(100).optional().nullable(),
  specNumber: z.string().trim().max(100).optional().nullable(),
  description: z.string().trim().max(2000).optional().nullable(),
  minimumQuantity: z.coerce.number().int().min(0, "Minimum quantity cannot be negative."),
  totalStockCapacity: z.coerce.number().int().min(0, "Capacity cannot be negative."),
  unitOfMeasure: z.string().trim().min(1).max(20).default("EA"),
  storageLocationId: z.string().min(1, "Storage location is required."),
  status: z.enum(toolStatusValues).default("ACTIVE"),
});

export const updateToolSchema = createToolSchema.partial().extend({
  version: z.coerce.number().int(),
});

export type CreateToolInput = z.infer<typeof createToolSchema>;
export type UpdateToolInput = z.infer<typeof updateToolSchema>;
