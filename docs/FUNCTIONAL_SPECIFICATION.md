# Functional Specification

## Page inventory

See `docs/ROUTES_AND_PERMISSIONS.md` for the full route/permission matrix.

## Core workflow (implemented end to end)

1. Sign in (`/login`) — credentials checked against a bcrypt hash (rate
   limited, lockout after repeated failures); session issued as an httpOnly
   JWT cookie. "Forgot password?" starts a single-use reset link.
2. Workspace (`/app/workspace`) — one cascading Facility → Department →
   Project picker. Levels with a single option are selected automatically and
   the last workspace is restored at sign-in. The header workspace pill opens
   the same picker. There is no skip option; with no project yet the user is
   sent to Projects to create one.
3. Projects (`/app/projects`) — two-column cards with Open, Record movement,
   Edit, Archive and Delete actions, and a prominent **+ Add project** form.
4. Dashboard (`/app/dashboard`) — live metric cards that filter the tool
   list (All, Available, Low stock, In sharpening, Scrapped, Out of stock), a
   stock-health filter, debounced search, and a "No tools yet" empty state
   with an Add Tool button. Everything is backed by the database.
5. Search/view a tool (`/app/tools/:id`) — shows master data, live computed
   available/sharpening/scrapped quantities, and recent movement lines.
6. Create/edit a tool (`/app/tools/new`, `/app/tools/:id/edit`) — Super Admins
   and Inventory Admins; inline field validation, and server-side validation;
   editing uses an optimistic `version` field to detect concurrent updates.
7. Record a movement (`/app/inventory/movements/new`, or from a tool or
   project) — multi-line, transaction-typed form with on-hand stock for each
   selected location, inline validation and a dedicated adjustment direction;
   submission is idempotent via a per-attempt `idempotencyKey`.
8. Movement history (`/app/inventory/movements`) — filterable, paginated;
   Reverse (with confirmation) is shown only with `movement.reverse`
   (compensating transaction, never a delete).
9. Every mutating action also writes an `AuditEvent` inside its transaction.

## Dashboard metric definitions

Defined precisely in `src/lib/inventory/stock.ts` (aggregated in SQL, over the
tools in the selected workspace):

- **Total Tool Types** — count of ACTIVE `Tool` master records in the
  workspace. This is a record count, not a physical quantity.
- **Total Available Stock** — sum of `onHandQuantity` across all
  `InventoryBalance` rows in the facility with `stockStatus = AVAILABLE`.
  A tool stored in multiple locations is summed once per location, not
  double-counted per tool.
- **Low Stock** — count of ACTIVE tools whose total AVAILABLE
  quantity in the facility is greater than zero but below the tool's
  `minimumQuantity`.
- **In Sharpening** — sum of `onHandQuantity` with `stockStatus =
  SHARPENING` in the facility (a unit count, not a tool count).
- **Scrapped** — sum of `onHandQuantity` with `stockStatus = SCRAPPED`.
- **Out of Stock** — count of ACTIVE tools with zero AVAILABLE quantity in
  the facility.

Clicking a card applies the matching `stock` filter to the tool list; the
list uses the same query as the card, so they cannot disagree.

## Inventory movement types and rules

Implemented in `src/lib/inventory/engine.ts`:

| Type | Effect | Required fields |
|---|---|---|
| RECEIPT | + AVAILABLE at destination | destination location |
| ISSUE | − AVAILABLE at source | source location |
| RETURN | + AVAILABLE at destination | destination location |
| TRANSFER | − AVAILABLE at source, + AVAILABLE at destination | both locations |
| ADJUSTMENT | ± AVAILABLE at a location | location, `adjustmentDirection`, mandatory reason; approval by a Super Admin unless the requester is one |
| SCRAP | − AVAILABLE, + SCRAPPED at same location | location |
| SHARPEN_DISPATCH | − AVAILABLE, + SHARPENING at same location | location |
| SHARPEN_RETURN | − SHARPENING, + AVAILABLE at same location | location |
| REVERSAL | Inverse of an ISSUE/RECEIPT/RETURN/TRANSFER, created via the reverse endpoint | — |

All quantity math and sufficiency checks happen server-side inside a single
database transaction with optimistic-concurrency version checks; the
frontend never determines or supplies the resulting balance.

## Business rules enforced

- Tool code is required and unique per organization.
- Quantities are non-negative integers.
- Creating/editing a tool never creates or changes stock — stock is created
  only via a RECEIPT movement (see seed script for the opening-balance
  pattern).
- Adjustments require a reason.
- A movement can only be reversed once, and only if its type is reversible
  (ISSUE, RECEIPT, RETURN, TRANSFER). Reversal creates a new movement; the
  original is marked `REVERSED` and never deleted.
- Idempotency keys prevent duplicate movement creation from retried
  requests.
