# TIMS — Tool Inventory Management System

Enterprise tool inventory, stock movement, and audit management system for
industrial tool rooms (reference context: "MX107-B4 Inventory").

## Stack

- Next.js 16 (App Router), React 19, TypeScript (strict)
- Tailwind CSS v4 for styling, centralized design tokens in `src/app/globals.css`
- Prisma ORM with PostgreSQL; SQLite migration history is retained separately
- JWT session cookie (httpOnly) for authentication; permissions always
  recomputed server-side from the database (never trusted from the token)
- Zod for request validation
- Vitest for unit/integration tests

## Prerequisites

- Node.js 20+
- npm

## Installation

```powershell
cd tims
npm install
# Configure DATABASE_URL in .env (see .env.example)
npm run prisma:migrate   # creates/applies PostgreSQL migrations
npm run prisma:seed      # inserts deterministic development data
```

## Local development

```powershell
npm run dev
```

Visit http://localhost:3000. You will be redirected to `/login`. After signing
in, the last workspace is restored and any level with a single option is opened
automatically. **Forgot password?** starts a self-service reset (mail setup in
`docs/DEPLOYMENT.md`).

Seed accounts (see `prisma/seed.ts`):

| Email | Password | Role |
|---|---|---|
| admin@etgroupindia.com | Password123! | Super Admin |
| inventory.admin@etgroupindia.com | Password123! | Inventory Admin (facility MX107-B4); creates/edits tools, requests adjustments |
| user@etgroupindia.com | Password123! | User (department TOOLROOM) |

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Start the Next.js dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run test` | Vitest unit/integration tests |
| `npm run prisma:generate` | Regenerate the Prisma client after schema changes |
| `npm run prisma:migrate` | Create/apply a local migration |
| `npm run prisma:seed` | Re-run the idempotent seed script |

## Configuration

All configuration is environment-based (`.env`). See `.env.example` for the
full list. `JWT_SECRET` must be set to a long random value in any shared or
production environment. Production refuses to sign sessions with a weak
(under 32 characters) or placeholder secret. Set `APP_BASE_URL`, `MAIL_FROM` and the `SMTP_*` variables (see `.env.example`) for password-reset
emails; they are sent from the shared mailbox (e.g. `noreply@etgroupindia.com`) to the user's
`@etgroupindia.com` address. Accounts must use that domain (`COMPANY_EMAIL_DOMAIN`).

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/FUNCTIONAL_SPECIFICATION.md](docs/FUNCTIONAL_SPECIFICATION.md)
- [docs/ROUTES_AND_PERMISSIONS.md](docs/ROUTES_AND_PERMISSIONS.md)
- [docs/DATA_MODEL.md](docs/DATA_MODEL.md)
- [docs/API.md](docs/API.md)
- [docs/SECURITY.md](docs/SECURITY.md)
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
- [docs/TESTING.md](docs/TESTING.md)
- [docs/ASSUMPTIONS_AND_GAPS.md](docs/ASSUMPTIONS_AND_GAPS.md)

## Troubleshooting

- **Workspace and administration** — the header workspace pill (or
  **Switch workspace** in the account menu) chooses where you work: one picker
  for facility, department and project, remembered between sign-ins. Super
  Admins manage records from the **Admin** tabs (Facilities, Users, Settings),
  which never change your workspace. If permissions fail to load, use **Retry
  permissions** on the access error screen; a failed request no longer
  silently changes the UI to read-only.
- **Back/Forward returns to a different page** — history destinations are
  checked against the live session. A missing/revoked facility or an
  incomplete workspace redirects to the workspace picker (or Projects when a
  department has no project yet).
- **"JWT_SECRET must be configured..."** — ensure `.env` exists and
  `JWT_SECRET` is at least 16 characters (32+ random characters and not a
  placeholder when `NODE_ENV=production`).
- **Locked out after failed sign-ins** — accounts unlock after 15 minutes, or a
  Super Admin can set a temporary password on the Users page.
- **Prisma client errors after pulling schema changes** — run
  `npm run prisma:generate`.
- **Prisma cannot load the datasource URL** — `DATABASE_URL` is read by
  `prisma.config.ts`; ensure it is a PostgreSQL connection string.
