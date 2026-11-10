# Deployment

## Environments

Use separate `.env` files / secret stores per environment (development, QA,
pre-production, production). Never share `JWT_SECRET` or database
credentials across environments.

## Local development

```powershell
npm install
npm run prisma:migrate
npm run prisma:seed
npm run dev
```

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | `file:./dev.db` (dev) or `postgresql://…` (production) |
| `JWT_SECRET` | yes | 16+ chars in dev; **32+ random chars, not a placeholder, in production** |
| `APP_BASE_URL` | production | Public origin used in password-reset links (for example `https://tims.example.com`) |
| `MAIL_WEBHOOK_URL` | optional | HTTPS endpoint that accepts `{ to, subject, text }` and sends the mail. Without it, reset links are logged in development and Super Admins are notified in production |
| `SESSION_COOKIE_NAME`, `SESSION_COOKIE_SECURE` | optional | Cookie name and forced `Secure` flag |

Generate a secret with `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`.

## Switching to PostgreSQL for production

SQLite is for development only: it serializes all writers, has no row-level locking, and keeps
the database in one local file. Plan the move like this:

1. **Provision** PostgreSQL 15+ (managed service preferred), a least-privilege application role,
   TLS, automated backups and point-in-time recovery.
2. **Switch the provider** in `prisma/schema.prisma` to `provider = "postgresql"` and set
   `DATABASE_URL`. Do not reuse the SQLite migration folder as-is: it contains SQLite-only SQL
   (`DATETIME`, `PRAGMA`, table rebuilds). On a new empty database run
   `npx prisma migrate dev --name init_postgres` once to generate a Postgres baseline, commit it
   and replace the SQLite migrations (keep them in git history).
3. **Copy data** (if there is any worth keeping) with a one-off script that reads through the
   SQLite Prisma client and writes through the Postgres client in dependency order
   (Organization, Facility, Department, Project, User, memberships and grants, StorageLocation,
   Tool, InventoryBalance, InventoryMovement, MovementLine, Approval, AuditEvent, Notification),
   then compare row counts and per-tool balances.
4. **Verify** `SELECT`-level parity: for every tool, available/sharpening/scrapped totals and the
   ledger must match before and after; run `npm test` against a Postgres test database.
5. **Cut over** during a maintenance window: stop writes, run the copy, switch `DATABASE_URL`,
   deploy, smoke-test sign-in, a movement and a reversal.

What already works on both databases: all dashboard aggregation is done in SQL with standard
quoted identifiers (`src/lib/inventory/stock.ts`); the schema uses no SQLite-only types; balances
use optimistic versions; movement numbers come from the `Sequence` table, which increments
atomically on Postgres as well. Optional follow-ups after the move: replace `Sequence` with a native
`SEQUENCE`, use `SELECT … FOR UPDATE` instead of optimistic retries on hot balances, and move the
rate-limit counters to a shared store.

Indexes added for scale: `InventoryMovement(organizationId, occurredAt)`,
`InventoryMovement(facilityId, occurredAt)`, `InventoryMovement(projectId)` and
`AuditEvent(organizationId, occurredAt)`.

## Docker Compose (local Postgres, optional)

```yaml
# docker-compose.yml (add if you want local Postgres instead of SQLite)
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: tims
      POSTGRES_PASSWORD: devpassword
      POSTGRES_DB: tims
    ports:
      - "5432:5432"
    volumes:
      - tims_db_data:/var/lib/postgresql/data
volumes:
  tims_db_data:
```

Then set `DATABASE_URL="postgresql://tims:devpassword@localhost:5432/tims"`.

## Build and run

```powershell
npm run build
npm run start
```

## Health checks

`GET /api/v1/auth/session` can be used as a liveness/readiness check — it
returns `200` for any request with a valid session and `401` otherwise
(both indicate the app is up and able to query the database).

## Backup and restore

- **SQLite (dev)**: the database is a single file (`prisma/dev.db` by
  default). Stop the dev server and copy the file to back it up.
- **PostgreSQL (production)**: use `pg_dump`/`pg_restore` on a scheduled
  basis; store backups encrypted at rest. Document your retention policy
  alongside your infrastructure-as-code.

## Rollback

- Application: redeploy the previous container image/build artifact.
- Database: Prisma migrations are additive-first; destructive migrations
  should be reviewed manually before `prisma migrate deploy` in
  production. Keep a tested down-migration or restore-from-backup plan for
  any migration that drops or renames columns.
