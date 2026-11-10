-- Login hardening, session invalidation, last-workspace memory.
ALTER TABLE "User" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "failedLoginCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "lockedUntil" DATETIME;
ALTER TABLE "User" ADD COLUMN "lastFacilityId" TEXT;
ALTER TABLE "User" ADD COLUMN "lastDepartmentId" TEXT;
ALTER TABLE "User" ADD COLUMN "lastProjectId" TEXT;

-- Dedicated adjustment direction (replaces the "source == destination means decrease" encoding).
ALTER TABLE "MovementLine" ADD COLUMN "adjustmentDirection" TEXT;
UPDATE "MovementLine"
SET "adjustmentDirection" = CASE WHEN "sourceLocationId" IS NULL THEN 'INCREASE' ELSE 'DECREASE' END
WHERE "movementId" IN (SELECT "id" FROM "InventoryMovement" WHERE "movementType" = 'ADJUSTMENT');

-- Movement-number counter, seeded so new numbers never collide with existing rows.
CREATE TABLE "Sequence" (
    "name" TEXT NOT NULL PRIMARY KEY,
    "value" INTEGER NOT NULL DEFAULT 0
);
INSERT INTO "Sequence" ("name", "value") SELECT 'movement', COUNT(*) FROM "InventoryMovement";

CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- Time-ordered access paths for movement history and audit queries.
DROP INDEX "InventoryMovement_organizationId_idx";
DROP INDEX "InventoryMovement_facilityId_idx";
CREATE INDEX "InventoryMovement_organizationId_occurredAt_idx" ON "InventoryMovement"("organizationId", "occurredAt");
CREATE INDEX "InventoryMovement_facilityId_occurredAt_idx" ON "InventoryMovement"("facilityId", "occurredAt");
CREATE INDEX "InventoryMovement_projectId_idx" ON "InventoryMovement"("projectId");

DROP INDEX "AuditEvent_organizationId_idx";
CREATE INDEX "AuditEvent_organizationId_occurredAt_idx" ON "AuditEvent"("organizationId", "occurredAt");
