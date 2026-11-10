# Assumptions and Gaps

This project is derived from a written specification (not direct inspection
of the reference application's source code or a verified video capture).
Where a business rule was ambiguous, a conservative, documented default was
chosen and made easy to change.

## Assumptions

1. **Low Stock definition** — "available quantity > 0 and < minimumQuantity"
   at the tool level, aggregated across all locations in the active
   facility. An alternative per-location definition is plausible; see
   `src/lib/inventory/summary.ts`.
2. **Out of Stock definition** — available quantity == 0 for an ACTIVE
   tool in the active facility.
3. **"In Sharpening" / "Scrapped" dashboard metrics** — modeled as unit
   counts (sum of on-hand quantity in those stock statuses), not record
   counts, since they are inventory quantities.
4. **Opening stock** — a tool's `totalStockCapacity` is master data only;
   actual opening stock must be posted via a RECEIPT movement (see
   `prisma/seed.ts` for the pattern). No UI auto-creates a balance from
   capacity.
5. **Adjustment direction** — each `ADJUSTMENT` line carries a dedicated
   `adjustmentDirection` (`INCREASE` / `DECREASE`) applied at a single
   location. Migration `20261020000000_hardening` converted existing rows
   from the earlier "source equals destination means decrease" encoding.
6. **Scoping is explicit** — only a Super Admin is unrestricted. An
   Inventory Admin sees exactly the facilities in `InventoryAdminFacility`
   (and every department/project beneath them); a User sees exactly the
   departments in `UserDepartmentAccess` (and their projects and facilities).
   An empty grant set means no access. Balances are facility-level, but every
   tool, movement, summary and history view is narrowed by the same shared
   workspace scope (selected project, else department, else facility) so
   counts and lists always agree.
7. **Reversal eligibility** — only `ISSUE`, `RECEIPT`, `RETURN`, and
   `TRANSFER` are reversible; `ADJUSTMENT`/`SCRAP`/`SHARPEN_*` require a
   new compensating movement of the appropriate type instead, since a
   generic reversal of those could hide the original business reason.
8. **Roles are fixed** — there are exactly three roles (`SUPER_ADMIN`,
   `INVENTORY_ADMIN`, `USER`) with permissions defined in
   `src/lib/authz/permissions.ts`; they are not configurable at runtime.
9. **Inventory Admin operations** — beyond user and project management,
   Inventory Admins create and edit tools, post and reverse stock movements
   within their facilities and request stock adjustments. Facilities,
   departments, settings and adjustment approval are Super Admin only. Adjust
   `ROLE_PERMISSIONS.INVENTORY_ADMIN` if that boundary should change.
10. **Low-stock notifications** — after each posted movement or reversal,
    users with access to the facility whose role includes
    `inventory.summary.read` receive a
    `LOW_STOCK` notification when a tool's available stock in the facility
    drops below its minimum; an unread alert for the same tool is not
    duplicated. Delivery is in-app only (no email/push).
11. **Adjustment approval** — every `ADJUSTMENT` from a user without
    `stock.adjust.approve` is held as `PENDING_APPROVAL` (no stock change)
    until someone with that permission and access to the facility approves
    or rejects it. Only `SUPER_ADMIN` holds `stock.adjust.approve`, so an
    Inventory Admin's adjustment always needs a second person (previously
    Inventory Admins held both permissions and approval never triggered).
    There is no quantity threshold; nobody can approve their own request.
    `SCRAP` and other types are not subject to approval. A pending request
    that would make stock negative at approval time fails with 409 and
    stays pending. There is no operator role; the application has exactly
    three roles.
12. **Reports and audit-log screens** are not part of the product. Audit
    events are still written (inside the business transaction) and can be
    queried in the database.
13. **Password reset** — self-service reset emails a single-use link through
    the `MAIL_WEBHOOK_URL` relay. Without a relay (or when delivery fails),
    Super Admins are notified and can set a temporary password from the
    Users page. Production needs `APP_BASE_URL` so links are never built from
    the request `Host` header.

## Deferred / not yet implemented

- **Shared rate limiting** — login, forgot-password and reset-password are
  rate limited in process memory (and accounts lock after 5 failures, which
  is stored in the database). Behind several instances, repeat the per-IP limits
  at the reverse proxy/gateway, or move the counters to Redis/Postgres.
- **SQLite → PostgreSQL** — see `docs/DEPLOYMENT.md` for the migration plan.
- **OpenAPI document** — `docs/API.md` documents the contract by hand;
  generating a formal OpenAPI spec from the Zod schemas is a follow-up.
- **SSO/OIDC/MFA** — the credential-based login is the implemented path;
  integration points for enterprise identity are not wired up (would
  replace `/api/v1/auth/login` with an OIDC callback handler feeding the
  same session-issuance code path).
- **Browser end-to-end tests** — see `docs/TESTING.md`.

## Explicitly rejected shortcuts

- No hardcoded production admin credentials — only documented, clearly
  fictional development seed accounts.
- No frontend-only authorization — every permission check is duplicated
  server-side regardless of what the UI hides.
- No direct mutation of `InventoryBalance` outside
  `src/lib/inventory/engine.ts`.
