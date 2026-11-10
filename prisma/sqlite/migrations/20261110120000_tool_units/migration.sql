-- CreateTable
CREATE TABLE "ToolUnit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "toolId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "locationId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ToolUnit_toolId_fkey" FOREIGN KEY ("toolId") REFERENCES "Tool" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ToolUnit_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StorageLocation" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ToolUnit_toolId_sequence_key" ON "ToolUnit"("toolId", "sequence");
CREATE INDEX "ToolUnit_toolId_status_idx" ON "ToolUnit"("toolId", "status");
CREATE INDEX "ToolUnit_facilityId_locationId_status_idx" ON "ToolUnit"("facilityId", "locationId", "status");

-- AlterTable
ALTER TABLE "MovementLine" ADD COLUMN "toolUnitId" TEXT REFERENCES "ToolUnit" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "MovementLine_toolUnitId_idx" ON "MovementLine"("toolUnitId");
