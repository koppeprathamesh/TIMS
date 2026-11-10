-- DropIndex
DROP INDEX "Permission_code_key";

-- DropIndex
DROP INDEX "Role_code_key";

-- DropIndex
DROP INDEX "UserRole_organizationId_idx";

-- DropIndex
DROP INDEX "UserRole_userId_idx";

-- AlterTable
ALTER TABLE "Department" ADD COLUMN "description" TEXT;
ALTER TABLE "Department" ADD COLUMN "imageUrl" TEXT;

-- AlterTable
ALTER TABLE "Facility" ADD COLUMN "description" TEXT;
ALTER TABLE "Facility" ADD COLUMN "imageUrl" TEXT;

-- CreateTable
CREATE TABLE "InventoryAdminFacility" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "grantedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InventoryAdminFacility_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InventoryAdminFacility_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InventoryAdminFacility_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserDepartmentAccess" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "grantedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserDepartmentAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UserDepartmentAccess_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "UserDepartmentAccess_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_User" ("createdAt", "displayName", "email", "id", "passwordHash", "status", "updatedAt") SELECT "createdAt", "displayName", "email", "id", "passwordHash", "status", "updatedAt" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Backfill: keep existing super admins; everyone else becomes USER until an admin grants access.
UPDATE "User" SET "role" = 'SUPER_ADMIN'
WHERE "id" IN (
    SELECT ur."userId" FROM "UserRole" ur JOIN "Role" r ON r."id" = ur."roleId" WHERE r."code" = 'SUPER_ADMIN'
);

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Permission";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Role";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "RolePermission";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "UserRole";
PRAGMA foreign_keys=on;

-- CreateIndex
CREATE INDEX "InventoryAdminFacility_facilityId_idx" ON "InventoryAdminFacility"("facilityId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryAdminFacility_userId_facilityId_key" ON "InventoryAdminFacility"("userId", "facilityId");

-- CreateIndex
CREATE INDEX "UserDepartmentAccess_departmentId_idx" ON "UserDepartmentAccess"("departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "UserDepartmentAccess_userId_departmentId_key" ON "UserDepartmentAccess"("userId", "departmentId");

