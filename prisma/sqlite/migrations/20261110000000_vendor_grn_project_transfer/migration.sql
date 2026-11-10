-- CreateTable
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "facilityId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    CONSTRAINT "Vendor_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_facilityId_code_key" ON "Vendor"("facilityId", "code");

-- AlterTable
ALTER TABLE "InventoryMovement" ADD COLUMN "vendorId" TEXT REFERENCES "Vendor" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InventoryMovement" ADD COLUMN "grnNumber" TEXT;
ALTER TABLE "InventoryMovement" ADD COLUMN "transferFromProjectId" TEXT REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InventoryMovement" ADD COLUMN "transferToProjectId" TEXT REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
