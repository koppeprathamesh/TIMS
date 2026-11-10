# Deployment

## Environments

Use separate `.env` files / secret stores per environment (development, QA,
pre-production, production). Never share `JWT_SECRET` or database
credentials across environments.

## Local development

Set `DATABASE_URL` to a PostgreSQL database before running these commands.

```powershell
npm install
npm run prisma:migrate
npm run prisma:seed
npm run dev
```

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string, read by `prisma.config.ts` |
| `JWT_SECRET` | yes | 16+ chars in dev; **32+ random chars, not a placeholder, in production** |
| `APP_BASE_URL` | production | Public origin used in password-reset links (for example `https://tims.example.com`) |
| `MAIL_WEBHOOK_URL` | optional | HTTPS endpoint that accepts `{ to, subject, text }` and sends the mail. Without it, reset links are logged in development and Super Admins are notified in production |
| `SESSION_COOKIE_NAME`, `SESSION_COOKIE_SECURE` | optional | Cookie name and forced `Secure` flag |

Generate a secret with `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`.

## PostgreSQL migrations

PostgreSQL is the active provider. Prisma CLI connection settings are in
`prisma.config.ts`; the active migration history is `prisma/postgres/migrations`.
The older SQLite migrations are not applied by this configuration and must not
be copied into the PostgreSQL history. The initial PostgreSQL baseline is in
`prisma/postgres/migrations`; run `npm run prisma:migrate` during development to
apply it and create later migrations. Use `npx prisma migrate deploy` to apply
committed migrations in shared or production environments.

## Moving legacy SQLite data

If existing SQLite data needs to be retained, copy it with a one-off script that reads through
the SQLite Prisma client and writes through the Postgres client in dependency order
(Organization, Facility, Department, Project, User, memberships and grants, StorageLocation,
Tool, InventoryBalance, InventoryMovement, MovementLine, Approval, AuditEvent, Notification),
then compare row counts and per-tool balances.
Verify `SELECT`-level parity: for every tool, available/sharpening/scrapped totals and the
ledger must match before and after; run `npm test` against a dedicated PostgreSQL test database.

Dashboard aggregation uses standard quoted identifiers
(`src/lib/inventory/stock.ts`); balances use optimistic versions; movement numbers come from the
`Sequence` table, which increments atomically on PostgreSQL as well. Optional follow-ups include
replacing `Sequence` with a native `SEQUENCE`, using `SELECT … FOR UPDATE` instead of optimistic
retries on hot balances, and moving rate-limit counters to a shared store.

Indexes added for scale: `InventoryMovement(organizationId, occurredAt)`,
`InventoryMovement(facilityId, occurredAt)`, `InventoryMovement(projectId)` and
`AuditEvent(organizationId, occurredAt)`.

## Docker Compose (local Postgres, optional)

```yaml
# docker-compose.yml (optional local PostgreSQL)
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

- **PostgreSQL**: use `pg_dump`/`pg_restore` on a scheduled basis; store backups encrypted at rest.
  Document your retention policy alongside your infrastructure-as-code.

## Rollback

- Application: redeploy the previous container image/build artifact.
- Database: Prisma migrations are additive-first; destructive migrations
  should be reviewed manually before `prisma migrate deploy` in
  production. Keep a tested down-migration or restore-from-backup plan for
  any migration that drops or renames columns.
