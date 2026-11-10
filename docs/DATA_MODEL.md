# Data Model

Full definition: `prisma/schema.prisma`.

## Entity summary

- **Organization** — tenant root.
- **Facility** — belongs to an Organization; unique `(organizationId, code)`.
  Has `description` and `imageUrl` for its card.
- **Department** — belongs to a Facility; unique `(facilityId, code)`. Has
  `description` and `imageUrl` for its card.
- **Project** — belongs to an Organization, optionally a Department; unique
  `(organizationId, code)`. Access derives from its Department.
- **User** — global identity; `passwordHash` only, never plaintext. `role` is
  one of `SUPER_ADMIN | INVENTORY_ADMIN | USER`. `tokenVersion` revokes sessions
  (bumped on password reset/deactivation); `failedLoginCount` / `lockedUntil`
  drive account lockout; `lastFacilityId` / `lastDepartmentId` / `lastProjectId`
  remember the last workspace (re-validated before use).
- **PasswordResetToken** — hashed, single-use, expiring reset tokens.
- **Sequence** — named counters; `movement` numbers the ledger (`MV-000123`).
- **OrganizationMembership** — many-to-many User↔Organization.
- **InventoryAdminFacility** — junction granting an Inventory Admin
  management of a Facility (their departments, projects and users follow).
- **UserDepartmentAccess** — junction granting a User view access to a
  Department; records which admin granted it.
- **StorageLocation** — physical location within a Facility; unique
  `(facilityId, code)`.
- **Tool** — master data only (code, name, drawing/spec numbers, min qty,
  capacity, default location, status, optimistic `version`). Unique
  `(organizationId, code)`. Never holds a live stock quantity.
- **Machine** — belongs to a Facility.
- **InventoryBalance** — materialized, reconcilable stock balance keyed by
  `(toolId, locationId, stockStatus)` with its own optimistic `version`.
  `stockStatus` ∈ `AVAILABLE | SHARPENING | SCRAPPED`.
- **InventoryMovement** — the authoritative ledger header: type, status,
  actor, project/machine, idempotency key, optional
  `reversalOfMovementId`.
- **MovementLine** — per-tool quantity + source/destination location for a
  movement; `adjustmentDirection` (`INCREASE | DECREASE`) on `ADJUSTMENT` lines.
- **Approval** — adjustment sign-off records (approve/reject, approver,
  reason), written when a Super Admin decides a pending adjustment.
- **AuditEvent** — security- and business-relevant event log (actor,
  action, resource, outcome, correlation id, JSON metadata), indexed by
  `(organizationId, occurredAt)`.
- **Notification** — personal in-app notifications (low stock, approvals).

## Integrity rules

- Foreign keys on every relationship above.
- Unique constraints scope business identifiers per tenant/facility
  (`code` fields), preventing cross-tenant collisions while allowing the
  same code in different organizations.
- `minimumQuantity`, `totalStockCapacity`, `onHandQuantity`,
  `reservedQuantity` are modeled as non-negative integers; the application
  layer additionally rejects negative values and non-integers via Zod and
  the movement engine (a resulting negative balance is rejected inside the
  transaction before any write).
- `Tool`, `InventoryBalance` carry a `version` column used for optimistic
  concurrency control on every update.
- Movements and their lines are never deleted or mutated after posting —
  corrections are modeled as new REVERSAL movements
  (`reversalOfMovementId`), and the original's `status` becomes `REVERSED`.
- Timestamps are UTC (`DateTime` columns via Prisma, stored as ISO-8601).

## Reconciliation

`InventoryBalance.onHandQuantity` is a projection: at any point it must
equal the sum of all `MovementLine` effects for that `(tool, location,
stockStatus)` combination. Because every mutation goes through
`src/lib/inventory/engine.ts` inside a single Prisma transaction alongside
the ledger write, the projection and the ledger can never diverge under
normal operation; a reconciliation report comparing the two is a
documented future enhancement (see ASSUMPTIONS_AND_GAPS.md).
