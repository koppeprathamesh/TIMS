import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

interface AuditInput {
  organizationId?: string | null;
  actorId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  outcome?: "SUCCESS" | "DENIED" | "ERROR";
  correlationId?: string;
  metadata?: Record<string, unknown>;
}

// Pass the transaction client from the business write so the audit row commits or rolls back with it.
export async function recordAuditEvent(input: AuditInput, db: Prisma.TransactionClient = prisma) {
  await db.auditEvent.create({
    data: {
      organizationId: input.organizationId ?? null,
      actorId: input.actorId ?? null,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      outcome: input.outcome ?? "SUCCESS",
      correlationId: input.correlationId,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    },
  });
}
