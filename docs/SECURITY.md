# Security

## Authentication

- Passwords hashed with bcrypt (`bcryptjs`, 12 salt rounds) — never stored
  or logged in plaintext.
- Session carried in an `httpOnly`, `sameSite=lax` cookie containing a
  signed (HS256) JWT. `JWT_SECRET` is required: at least 16 characters in
  development and **at least 32 characters, not a known placeholder, in
  production** (checked when a session is signed or verified, so a weak secret
  fails loudly instead of silently). In production the cookie is also marked
  `secure` over HTTPS.
- The JWT only carries `userId`, a `tv` (token version) and the selected
  organizational context — **never** permissions or roles. Every request
  recomputes permissions from the database, so a leaked/replayed token cannot
  act with elevated access beyond the user's current DB-assigned roles.
- **Session invalidation** — `User.tokenVersion` is incremented on password
  reset (admin or self-service) and on deactivation; a token whose `tv` no
  longer matches is rejected with `401`, ending every earlier session.
- **Brute-force protection** — `/auth/login` is rate limited per IP (30 / 15 min)
  and per email (10 / 15 min), answers `429` with `Retry-After`, and locks an
  account for 15 minutes after 5 consecutive failures (counter on the user
  row). A bcrypt comparison always runs, including for unknown emails, and
  every refusal returns the same message, so neither timing nor wording
  reveals whether an account exists or is locked.
- **Password reset** — random 256-bit token, stored only as a SHA-256 hash,
  single use, 30-minute expiry, previous tokens replaced on a new request.
  Links use `APP_BASE_URL` (never the `Host` header) and the endpoint always
  returns the same `202` message. Completing a reset clears the lockout and
  bumps `tokenVersion`.
- Session expiry: 8 hours. Logout clears the cookie immediately
  (`maxAge: 0`).
- The in-process rate limiter protects one server instance. Behind several
  instances, repeat the limits at the gateway or move the counters to a shared
  store.

## Authorization

- Centralized permission registry (`src/lib/authz/permissions.ts`) and a
  single enforcement surface (`src/lib/authz/authorize.ts`) used by every
  API route — never only implemented as a hidden UI control.
- Deny-by-default: every mutating route explicitly calls
  `requirePermission()`; context (facility/project) access is separately
  checked via `assertFacilityAccess`/`assertProjectAccess`.
- Multi-tenant isolation: every query filters by `organizationId` /
  `facilityId` derived from the authenticated session context, not from
  client-supplied identifiers alone — IDs supplied in the body/path are
  always re-validated against the authenticated user's scope
  (`findFirst({ where: { id, organizationId } })` pattern), preventing
  insecure direct object reference (IDOR) across tenants.
- **One scope definition** — tool and movement visibility comes from
  `toolScopeWhere` / `movementScopeWhere` / `requireToolInScope`. Tool detail,
  edit, deactivate, history, balances, movement history, posting, approval and
  reversal all use it, and resources outside the caller's workspace answer
  `404`.
- **Least data** — responses are shaped by DTOs (`src/lib/dto.ts`); internal
  ids and bookkeeping columns are not returned.
- **Query validation** — query strings are parsed with Zod (`parseQuery`);
  invalid input is `400`, and `sortBy` is a whitelist.

## Web security (OWASP Top 10 mitigations)

- **Injection** — Prisma parameterizes all queries. The only raw SQL is the
  dashboard aggregation in `src/lib/inventory/stock.ts`, which uses tagged
  `Prisma.sql` templates (bound parameters, no string concatenation).
- **Broken access control** — see Authorization above; covered by the
  required security tests in `docs/TESTING.md`.
- **Cryptographic failures** — secrets only via environment variables;
  `.env` is gitignored; `.env.example` has placeholders only.
- **Insecure design** — stock mutations are transactional and
  idempotent; quantities can never go negative; movements are append-only.
- **Security misconfiguration** — `JWT_SECRET` is validated whenever a session
  is signed or verified (strong, non-placeholder in production); errors never leak stack traces (`src/lib/errors.ts` returns a
  generic message + correlation id for unexpected errors, logging details
  only server-side).
- **Vulnerable/outdated components** — dependencies pinned via
  `package.json`/lockfile; run `npm audit` periodically (not automated in
  this phase — documented gap).
- **Identification/authentication failures** — bcrypt hashing, generic
  "invalid email or password" message (no user enumeration), failed logins
  recorded as `DENIED` audit events.
- **Software/data integrity** — movement ledger is append-only;
  reversals are new records, never deletions/mutations of history.
- **Logging/monitoring failures** — every mutating action and every
  auth attempt writes an `AuditEvent` with actor, action, resource,
  outcome, and correlation id.
- **SSRF** — the application makes no server-side outbound requests based
  on user-supplied URLs.

## CSRF considerations

The session cookie is `sameSite=lax`, which blocks cross-site POST/PATCH
requests from third-party sites in modern browsers. All mutating API
routes also require a valid session; there is no state-changing GET
endpoint. A dedicated CSRF token is a documented enhancement for browsers
or embedding contexts where `sameSite=lax` is insufficient (see
ASSUMPTIONS_AND_GAPS.md).

## Audit logging

`AuditEvent` records: `actorId`, `action`, `resourceType`, `resourceId`,
`outcome`, `correlationId`, `occurredAt`, and a JSON `metadata` blob. No
secrets or tokens are ever included in metadata. Mutations write their audit row
inside the same database transaction as the change (`recordAuditEvent(input, tx)`),
so a failed audit insert rolls the change back. Failed logins are recorded
best-effort (a login refusal never depends on the audit table). There is no
audit-log screen; query `AuditEvent` directly.

## Secrets management

- Local dev: `.env` (gitignored) with development-only values.
- `.env.example` documents required variables with placeholders only.
- Production: inject `DATABASE_URL`, `JWT_SECRET` (32+ random characters),
  `APP_BASE_URL` and optionally `MAIL_WEBHOOK_URL` via your platform's
  secrets manager — never commit real values.
