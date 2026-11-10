# API Reference

Base path: `/api/v1`. All endpoints require the `tims_session` httpOnly
cookie except `POST /auth/login`, `/auth/forgot-password` and `/auth/reset-password`.
Responses use a consistent envelope:

```json
{ "data": ... }
```
or
```json
{ "data": [...], "pagination": { "page": 1, "pageSize": 25, "total": 42, "totalPages": 2 } }
```

Errors:

```json
{ "error": { "code": "BAD_REQUEST", "message": "...", "details": {...}, "correlationId": "..." } }
```

No stack traces, SQL, or internal details are ever included. Responses carry only the fields the
UI needs: organization ids, creator ids, idempotency keys and raw foreign keys are not returned.

### Query parameters

Query strings are validated like request bodies. `page=abc`, `pageSize=999`, `dateFrom=zzz`,
`sortBy=bogus` and unknown enum values return `400 BAD_REQUEST` with `details.fieldErrors`, never `500`.
Blank values (`?search=&status=`) are treated as absent. `sortBy` is a whitelist (tools:
`name`, `code`, `minimumQuantity`, `updatedAt`); internal columns cannot be sorted on.

## Authentication

```
POST /api/v1/auth/login            { email, password } -> sets session cookie
POST /api/v1/auth/logout           -> clears session cookie
POST /api/v1/auth/forgot-password  { email } -> 202, same answer whether or not the account exists
POST /api/v1/auth/reset-password   { token, password } -> sets a new password and signs the user out everywhere
GET  /api/v1/auth/session          -> { user, organization, facility, department, project, workspaceStep, role, permissions }
GET  /api/v1/me/permissions        -> { role, permissions: string[] }
```

Login hardening: per-IP and per-email rate limits (`429` with `Retry-After`), account lockout for
15 minutes after 5 consecutive failures, a bcrypt comparison even for unknown emails, and one
generic `401` message for every refusal. Sessions carry the user's `tokenVersion`; a password
reset or deactivation increments it, which invalidates every session issued earlier. Reset tokens
are random, stored hashed, single-use and expire after 30 minutes.

## Context

```
GET  /api/v1/facilities
GET  /api/v1/departments?facilityId=...
GET  /api/v1/projects?departmentId=...
POST /api/v1/context           { facilityId? | departmentId? | projectId? } -> re-issues session cookie
```

The session response uses `Cache-Control: private, no-store`; selected entities are revalidated
against current scope, active status and ancestry before being returned. Invalid selections become
`null` and `workspaceStep` returns the earliest incomplete level (`facility`, `department`,
`project`, `ready`).

Selecting a level resets the levels below it, then every level that has exactly one accessible
option is chosen automatically. `projectId` alone is enough (its department is derived). The
resulting workspace is stored as the user's last workspace and restored at the next sign-in if it
is still valid. A department or project outside the facility, or outside the caller's grants, is
rejected. There is no "skip" option.

## Tools

```
GET    /api/v1/tools?search=&status=&stock=&locationId=&projectId=&page=&pageSize=&sortBy=&sortDir=
POST   /api/v1/tools            { code, name, drawingNumber?, specNumber?, minimumQuantity,
                                   totalStockCapacity, unitOfMeasure, storageLocationId, status }
GET    /api/v1/tools/:toolId
PATCH  /api/v1/tools/:toolId    { ...fields, version }   -- version is required (optimistic concurrency)
POST   /api/v1/tools/:toolId/deactivate
GET    /api/v1/tools/:toolId/movements?page=
```

`stock` is one of `ALL`, `OK`, `LOW`, `OUT`, `AVAILABLE`, `SHARPENING`, `SCRAPPED`; it uses the same
scope and definitions as `/inventory/summary`, so a dashboard card count always equals the list it
opens. Detail, edit, deactivate and history routes answer `404` for tools outside the caller's
workspace scope. `PATCH` applies the version check inside the write, so two simultaneous editors
cannot both succeed (`409`). Super Admins and Inventory Admins hold `tool.create` / `tool.update`.

## Inventory

```
GET  /api/v1/inventory/summary
GET  /api/v1/inventory/balances?toolId=
GET  /api/v1/inventory/movements?movementType=&status=&toolId=&projectId=&actorId=&dateFrom=&dateTo=&page=&pageSize=
POST /api/v1/inventory/movements
     {
       movementType: "RECEIPT"|"ISSUE"|"RETURN"|"TRANSFER"|"ADJUSTMENT"|"SCRAP"|"SHARPEN_DISPATCH"|"SHARPEN_RETURN",
       lines: [{ toolId, quantity, sourceLocationId?, destinationLocationId?, adjustmentDirection? }],
       projectId?, machineId?, reason?, remarks?, idempotencyKey?
     }
GET  /api/v1/inventory/movements/:movementId
POST /api/v1/inventory/movements/:movementId/reverse
GET  /api/v1/machines
GET  /api/v1/storage-locations
```

A movement may contain up to 100 lines (several tools) and is posted atomically: if any line fails,
nothing changes. Tools and movements must be inside the caller's workspace scope.

`ADJUSTMENT` lines use one location (`destinationLocationId`) plus a required
`adjustmentDirection` of `INCREASE` or `DECREASE`. The field is rejected on every other type.

Movement numbers (`MV-000123`) come from a counter incremented inside the posting transaction.
Idempotency keys are namespaced per user; replaying a key returns the original movement, including
when two identical requests race.

### Example — issue a tool

```http
POST /api/v1/inventory/movements
Content-Type: application/json

{
  "movementType": "ISSUE",
  "lines": [{ "toolId": "clv...", "quantity": 2, "sourceLocationId": "clv..." }],
  "machineId": "clv...",
  "remarks": "Line 1 changeover",
  "idempotencyKey": "7f7e9b1e-..."
}
```

Response `201`:

```json
{ "data": { "id": "...", "movementNumber": "MV-000042", "movementType": "ISSUE", "status": "POSTED" } }
```

Insufficient stock → `409 CONFLICT` with details `{ available, requested }`.

### Reversal

`POST .../reverse` requires `movement.reverse` and a posted `ISSUE`, `RECEIPT`, `RETURN` or
`TRANSFER`. The original is claimed (`POSTED` → `REVERSED`) inside the same transaction that
restores stock and writes the reversal and its audit event, so two concurrent reversals can never
both apply (the loser gets `409`).

### Adjustment approval

An `ADJUSTMENT` posted by a user without `stock.adjust.approve` returns `201`
with `status: "PENDING_APPROVAL"` and does not change stock. Only Super Admins hold
`stock.adjust.approve`; Inventory Admins request, Super Admins decide.

```
POST /api/v1/inventory/movements/:movementId/approve   stock.adjust.approve
POST /api/v1/inventory/movements/:movementId/reject    {"reason": "..."}
GET  /api/v1/inventory/movements?status=PENDING_APPROVAL
```

Approving applies the stock change atomically and marks the movement
`POSTED`; rejecting marks it `CANCELLED`. Both record an `Approval` row, an
audit event and a notification to the requester. A request already decided
returns `409`; approving your own request returns `403`.

### Transactions and audit

Every mutation writes its audit event inside the same database transaction as the business change.
If the audit insert fails, the change rolls back; a request never returns an error after stock has
already moved. Notifications stay best-effort and run after commit.

## Administration

```
GET|POST   /api/v1/users                      user.read / user.manage
PATCH      /api/v1/users/:userId              {displayName?, status?, password?}
PUT        /api/v1/users/:userId/access       {facilityIds?} (Inventory Admin) | {departmentIds?} (User)
GET|POST   /api/v1/facilities                 facility.read / facility.manage (Super Admin)
PATCH      /api/v1/facilities/:id             {name?, description?, imageUrl?, status?}
GET|POST   /api/v1/departments                department.read / department.manage (Super Admin)
PATCH      /api/v1/departments/:id            {name?, description?, imageUrl?, status?}
GET|POST   /api/v1/projects                   project.read / project.create
PATCH|DELETE /api/v1/projects/:id             project.update / project.archive
GET|PATCH  /api/v1/settings                   settings.read / settings.manage
GET        /api/v1/notifications[?unread=true]
POST       /api/v1/notifications/read-all
POST       /api/v1/notifications/:id/read
```

`POST /users` body: `{email, displayName, password, role: "INVENTORY_ADMIN" | "USER",
facilityIds?, departmentIds?}`. An Inventory Admin requires `facilityIds`; a User
requires `departmentIds`. `GET /departments` accepts `facilityId`, `all=true` and
`includeInactive=true` (Super Admin only). `imageUrl` is an http(s) URL or an
uploaded PNG/JPEG/WebP/GIF data URL (about 500 KB max). A project that still has tools or
movements cannot be deleted; archive it instead.

Passwords must be 10-128 characters with a letter and a digit. Setting a password or deactivating
a user ends that user's sessions. Validation errors return `400` with `details.fieldErrors`. See
`ROUTES_AND_PERMISSIONS.md` for the admin safeguards.

Reports and audit-log endpoints were removed; audit events are still recorded in the database.

## Authentication & authorization notes

- Identity is carried in a signed (HS256), httpOnly JWT cookie (`SESSION_COOKIE_NAME`,
  default `tims_session`), 8-hour expiry.
- Role and scope are **never** read from the token — every request re-reads
  `User.role` plus the user's facility/department grants (see
  `src/lib/authz/authorize.ts`). Without an active organization membership a
  user holds no permissions.
- Facility/department/project access is enforced via `assertFacilityAccess` /
  `assertDepartmentAccess` / `assertProjectAccess` and the shared tool/movement scope helpers,
  independent of what the UI shows or hides.
