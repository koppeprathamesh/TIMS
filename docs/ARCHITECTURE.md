# Architecture

## Logical architecture

```
Browser (React / Next.js App Router)
  |
Next.js Route Handlers  (/api/v1/*)  — modular monolith, no microservices
  |
Domain services (src/lib/inventory/engine.ts, lib/authz, lib/audit)
  |
Prisma ORM
  |
PostgreSQL (production) / SQLite (local dev) — same schema, no DB-specific features
```

Cross-cutting: structured console logging on the server, correlation IDs in
error responses, audit events persisted per mutating action.

## Module boundaries

- `src/app/api/v1/**` — HTTP route handlers only. Validate input (Zod),
  resolve the request context, call a domain service, map errors.
- `src/lib/authz` — permission registry + request-context resolution
  (`getRequestContext`) + guard helpers (`requirePermission`,
  `assertFacilityAccess`, `assertProjectAccess`). This is the single place
  authorization decisions are made.
- `src/lib/inventory` — the inventory transaction engine (`engine.ts`) and
  stock aggregation (`stock.ts`, dashboard cards and stock-health filter, done
  in SQL). All stock mutations go through
  `createMovement`/`approveMovement`/`reverseMovement`; nothing else writes to
  `InventoryBalance`.
- `src/lib/auth` — password hashing, session (JWT) signing/verification,
  login rate limiting, password reset, workspace resolution/auto-selection.
- `src/lib/validation` — Zod schemas shared by route handlers (bodies and queries).
- `src/lib/dto.ts` — response shaping (only UI fields leave the server).
- `src/components` — `ui/` shared Button, Input/Field, Table, Badge, Alert,
  Skeleton, ConfirmDialog, Pagination; plus forms, layout and feedback states.
- `src/app/login`, `forgot-password`, `reset-password` and `src/app/app/**` —
  pages, calling the API via `src/lib/apiClient.ts`. `error.tsx`, `loading.tsx`
  and `global-error.tsx` provide crash and loading states.

## Data flow for a stock movement

1. Client submits a movement form → `POST /api/v1/inventory/movements`.
2. Route handler validates the payload and resolves `RequestContext`
   (identity + freshly computed permissions, from the DB, not the JWT).
3. `createMovement()` checks permission, facility/project scope, validates
   tools (inside the caller's workspace scope) and locations, then runs a
   single Prisma `$transaction`: it takes the next movement number from the
   `Sequence` table, and for each line reads the current balance, computes
   the new on-hand quantity, rejects negative results, and applies an
   optimistic-concurrency-protected update (`updateMany` keyed on `version`).
   The movement header + lines **and the audit event** are created in the
   same transaction.
4. Notifications (low stock, approval requests) run after commit and are
   best-effort.
5. The balance and movement are reconcilable: balances are a materialized
   projection of the movement ledger, never the sole record.

## Architecture decisions

- **Modular monolith**, not microservices — the problem does not require
  independent scaling/deployment of modules at this stage.
- **SQLite for local dev** — zero external dependency to start the app;
  schema deliberately avoids Postgres-only or SQLite-only types so switching
  the `provider` in `prisma/schema.prisma` is the only change required for
  production.
- **JWT cookie carries identity + context only** — the role and the
  facility/department/project scope are always recomputed server-side per
  request from `User.role`, `InventoryAdminFacility` and
  `UserDepartmentAccess`, so a compromised or stale token cannot grant stale
  permissions.
