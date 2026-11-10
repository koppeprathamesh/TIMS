# Testing

## Test commands

Set `TEST_DATABASE_URL` to a dedicated PostgreSQL test database first. The
test setup drops and recreates its `public` schema.

```powershell
npm run test        # Vitest — unit + integration
npm run lint         # ESLint
npm run build        # Next.js production build (includes TypeScript check)
```

## What is covered (implemented in `tests/`)

- **Client access regressions** — shared permission loading and the cached
  session (navigation never blanks the screen; a failed background refresh
  keeps the cache; `401` clears it), concurrent request deduplication,
  explicit failure and retry propagation, invalid responses, skeleton/error UI,
  the header (Admin tabs, one administration indicator, always-visible Logout,
  labelled avatar, workspace switcher, mobile menu button) and the login page
  (`tests/access-store.test.ts`, `tests/access-ui.test.ts`). These use the
  existing Vitest runner and React server rendering, not a browser simulator.
- **Navigation and workspace** — role-based destinations, the single workspace
  picker, legacy `/select-*` URLs, automatic selection of single options,
  restoring the remembered workspace, ancestry/grant rechecks, and the context
  API (`tests/navigation.test.ts`, `tests/workspace-navigation.test.ts`).
- **Scope and API hardening** (`tests/api-hardening.test.ts`) — tool detail,
  edit and history routes, the summary, stock filters and movement history all
  use one scope (hidden tools answer `404`); responses contain only UI fields;
  invalid query parameters (`page=abc`, `dateFrom=zzz`, `sortBy=bogus`) return
  `400`; Inventory Admins can create/edit tools but not approve adjustments;
  login rate limiting, lockout and constant-time behavior; token-version
  session revocation on password reset and deactivation; production
  `JWT_SECRET` rules; the password-reset flow (single use, expiry, no
  enumeration).
- **Unit** — available/low-stock/out-of-stock metric calculations and their
  agreement with the list filters (`tests/summary.test.ts`), permission registry
  shape (`tests/permissions.test.ts`), the admin modules — user/role/settings
  management, escalation and self-protection guards, tenant isolation,
  low-stock notifications (`tests/admin.test.ts`), and the adjustment approval
  workflow — hold, approve, reject, self-approval, scope, tenant isolation,
  negative-stock rollback, double-decision race (`tests/approvals.test.ts`).
- **Integration** (against a disposable PostgreSQL test database, migrated
  fresh per run) — `tests/engine.test.ts` and `tests/audit-atomicity.test.ts`:
  - Receipt increases available stock; issue decreases it and is rejected when
    insufficient; transfer moves stock between locations atomically.
  - Adjustments need a reason and a direction; the direction is refused on
    other types.
  - Multi-line movements post every line or none.
  - Idempotency keys prevent duplicates and are scoped per user.
  - Reversal restores the balance, marks the original `REVERSED`, rejects a
    second reversal, and of two concurrent reversals only one applies.
  - Movement numbers come from a collision-free sequence.
  - A failing audit write rolls the whole movement back.
  - Scrap/sharpening status transitions, per-type permission checks and facility grants.

Run `npm run test` to execute these — do not assume they pass without
running them; the project is configured so `npm run test` is the source of
truth.

## Browser smoke test (release gate)

1. Sign in as a Super Admin. The header (logo, workspace pill, account menu,
   **Logout**) must be visible immediately. With several facilities you land on
   **Choose your workspace**; with exactly one facility/department/project you
   land on the dashboard. Sign out and in again: the last workspace is restored.
2. Click the workspace pill, switch to another project and confirm the
   dashboard reloads for it. There must be no "Continue without…" option.
3. On the dashboard click **Low stock**, **Out of stock** and **Scrapped**:
   the list filters to match the card count. Change the stock-health dropdown,
   type in search (the list refreshes after a short pause), and clear
   everything to see "No tools yet" only in an empty project.
4. Open **Projects**: cards appear in two columns with Open, Record
   movement, Edit, Archive and Delete. **+ Add project** is prominent. Record
   movement opens the movement form for that project.
5. Record a multi-line movement. Check on-hand text beside Quantity, blank
   quantity shows an inline error (not 0), and Reverse asks for confirmation.
6. At about 760 px wide the navigation collapses behind the hamburger and
   Logout stays visible. Tab through the page: focus rings are visible, the
   avatar menu opens with arrow keys and closes with Escape.
7. Sign in as an Inventory Admin: **Add Tool** and **Edit** work, adjustments
   are held as *Pending approval*, and there is no Approve button. A User sees
   no Reverse, Add Tool or Edit actions.
8. From **Forgot password?** request a reset (the link is logged in
   development), set a new password, and confirm the old session is signed out.
9. Try five wrong passwords: the account locks and the message never says so.
10. Simulate a failed `/api/v1/auth/session` request on first load. Verify the
    explicit access error and **Retry permissions**, not a read-only UI.

Passing these checks only validates this flow; it does not certify the entire
application as production-ready.

## Test fixtures

Integration tests create their own organization/facility/location/tool
rows per test (no reliance on `prisma/seed.ts`). Set `TEST_DATABASE_URL` to a
dedicated PostgreSQL database before running them. `tests/global-setup.ts`
recreates that database's `public` schema and deploys migrations, so it must
never point to the application or production database.

## Not yet implemented (documented gap)

- Frontend component tests (React Testing Library) for forms and
  permission-dependent rendering.
- Full end-to-end browser tests (Playwright) covering the 12-step journey
  in the master prompt (login → context selection → movement → audit
  verification → unauthorized-action denial). The API-level integration
  tests exercise the same business rules; wiring a browser E2E suite is
  listed in `docs/ASSUMPTIONS_AND_GAPS.md`.
- Load testing of high-volume simultaneous issue requests. Concurrent
  double-reversal and double-approval are covered by tests; throughput under
  load on PostgreSQL is not.
