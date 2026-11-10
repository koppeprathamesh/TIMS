-- AlterTable: scope tools to a project so each project shows its own tool set.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Tool" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "drawingNumber" TEXT,
    "specNumber" TEXT,
    "description" TEXT,
    "minimumQuantity" INTEGER NOT NULL DEFAULT 0,
    "totalStockCapacity" INTEGER NOT NULL DEFAULT 0,
    "unitOfMeasure" TEXT NOT NULL DEFAULT 'EA',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "defaultLocationId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Tool_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Tool_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Tool_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Tool_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Tool_defaultLocationId_fkey" FOREIGN KEY ("defaultLocationId") REFERENCES "StorageLocation" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Tool" ("code", "createdAt", "createdById", "defaultLocationId", "description", "drawingNumber", "id", "minimumQuantity", "name", "organizationId", "specNumber", "status", "totalStockCapacity", "unitOfMeasure", "updatedAt", "updatedById", "version") SELECT "code", "createdAt", "createdById", "defaultLocationId", "description", "drawingNumber", "id", "minimumQuantity", "name", "organizationId", "specNumber", "status", "totalStockCapacity", "unitOfMeasure", "updatedAt", "updatedById", "version" FROM "Tool";
DROP TABLE "Tool";
ALTER TABLE "new_Tool" RENAME TO "Tool";
CREATE UNIQUE INDEX "Tool_organizationId_code_key" ON "Tool"("organizationId", "code");
CREATE INDEX "Tool_organizationId_idx" ON "Tool"("organizationId");
CREATE INDEX "Tool_projectId_idx" ON "Tool"("projectId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
