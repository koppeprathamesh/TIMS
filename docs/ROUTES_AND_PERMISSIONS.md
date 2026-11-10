# Routes and Permissions

## Frontend routes

| Route | Auth required | Notes |
|---|---|---|
| `/login` | No | A live authenticated session redirects to its current destination. The seed-credential hint is development-only |
| `/forgot-password`, `/reset-password?token=…` | No | Self-service password reset (single-use token, 30 minutes) |
| `/app/workspace` | Yes + `facility.read` | One cascading Facility → Department → Project picker. Levels with one option are chosen automatically; the last workspace is remembered. The header workspace pill opens the same picker |
| `/app/dashboard` | Yes + `inventory.summary.read`, complete workspace | Summary cards filter the tool list (`?stock=ALL/AVAILABLE/LOW/SHARPENING/SCRAPPED/OUT`); stock-health filter, debounced search |
| `/app/projects` | Yes + `project.read` | Reachable before a project exists. Two-column cards with Open / Record movement / Edit / Archive / Delete; `project.create` / `project.update` / `project.archive` gate the actions |
| `/app/tools/new` | `tool.create` (Super Admin and Inventory Admin) | |
| `/app/tools/:toolId` | `tool.read`, tool inside the caller's workspace scope | Out-of-scope tools return "not found" |
| `/app/tools/:toolId/edit` | `tool.update` (Super Admin and Inventory Admin) | |
| `/app/tools/:toolId/movements/new` | `movement.create` | Same multi-line form, tool pre-selected |
| `/app/inventory/movements` | `movement.read` (`movement.reverse` for Reverse, `stock.adjust.approve` for Approve/Reject) | |
| `/app/inventory/movements/new` | `movement.create` + the type-specific stock permission | Multi-line movement form |
| `/app/machines` | `machine.read` | |
| `/app/facilities`, `/app/facilities/:facilityId` | Super Admin + `facility.manage` | Administration; available before a workspace is chosen |
| `/app/users` | `user.read` (`user.manage` for create/edit/access/reset/deactivate) | Creation form adapts to the caller's role and scope |
| `/app/settings` | `settings.read` (`settings.manage` to edit) | Organization name |
| `/app/notifications` | Yes | Personal inbox; low-stock alerts, approval requests |
| `/select-facility`, `/select-department`, `/select-project`, `/edit-tool/:toolId`, `/tool/:toolId`, `/dashboard` | Yes | Legacy URLs that redirect to the canonical routes |
| `/unauthorized`, `/not-found` | — | Error states (`error.tsx` / `global-error.tsx` cover crashes) |

Reports and audit-log screens were removed. Audit events are still written for every mutation.

Frontend route guards are a UX convenience only; every API route performs
its own authorization check independent of the UI.

### Navigation

The header is shown on every `/app` page, including right after login: logo, workspace
switcher, account menu and an always-visible **Logout** button. Primary work areas are tabs
(Dashboard, Projects, Movements, Notifications); administration tabs (Facilities, Users,
Settings) sit after an **Admin** divider and are the only administration indicator. Below
`md` the tabs collapse into a hamburger menu.

### Workspace rules

- A workspace is complete when a facility, a department and a project are all selected.
  Dashboard, Movements and tool pages need a complete workspace; Projects, Notifications,
  Workspace and administration pages do not.
- There is no "continue without a department/project" option. A department with no projects
  sends the user to Projects, where creating the first project is the primary action.
- Selecting a level resets the levels below it and then re-applies automatic selection.
- The signed cookie only records selections. Role, membership, scope, active status and parent
  relationships are re-checked from the database on every request. The last workspace is stored
  on the user row and restored at sign-in only if it is still valid.

### Session and navigation cache

The client caches the verified session for the lifetime of the page. Navigating between routes
renders immediately from the cache and revalidates `/auth/session` (`cache: no-store`) in the
background; the skeleton only appears on the very first load. A `401` clears the cache and
returns the user to login; a transient network failure keeps the cached session instead of
blanking the screen. Back/Forward (`popstate`) and BFCache restoration force a revalidation.
Pages are remounted when the user or workspace changes so lists never survive a context switch.

`next.config.ts` keeps `instantInsights.validationLevel: "manual-warning"` because protected pages
are gated on live access.

- Invalid destinations are redirected with `router.replace`, not `push`.
- Missing/expired sessions go to login. A logged-in login-history entry goes to the current valid destination.
- Missing/revoked/inactive facilities send the user to the workspace picker.
- A destination lacking role permissions goes to the access-denied page. Non-Super-Admin facility
  administration goes to the current workspace destination.
- Network/server failures on first load show an explicit retry screen, never a fabricated identity.

## API routes (`/api/v1`)

| Method | Path | Required permission |
|---|---|---|
| POST | `/auth/login` | — |
| POST | `/auth/forgot-password`, `/auth/reset-password` | none (rate limited; always answers the same way) |
| POST | `/auth/logout` | — |
| GET | `/auth/session` | authenticated |
| GET | `/me/permissions` | authenticated |
| GET, POST | `/facilities` | `facility.read` (scoped) / `facility.manage` |
| PATCH | `/facilities/:facilityId` | `facility.manage` |
| GET, POST | `/departments` | `department.read` (scoped) / `department.manage` |
| PATCH | `/departments/:departmentId` | `department.manage` |
| GET, POST | `/projects` | `project.read` (scoped) / `project.create` + department access |
| PATCH, DELETE | `/projects/:projectId` | `project.update` / `project.archive` + project access |
| POST | `/context` | authenticated |
| GET, POST | `/storage-locations` | `tool.read` / `movement.create` |
| GET | `/tools` | `tool.read` |
| POST | `/tools` | `tool.create` |
| GET | `/tools/:toolId` | `tool.read` |
| PATCH | `/tools/:toolId` | `tool.update` |
| DELETE | `/tools/:toolId` | `tool.delete` (Super Admin and Inventory Admin); refused when the tool has movement history |
| POST | `/tools/:toolId/deactivate` | `tool.deactivate` |
| GET | `/tools/:toolId/movements` | `movement.read` |
| GET | `/inventory/summary` | `inventory.summary.read` |
| GET | `/inventory/balances` | `stock.read` |
| GET | `/inventory/movements` | `movement.read`; filtered to tools in the caller's workspace scope |
| POST | `/inventory/movements` | movement-type-specific (`stock.issue`, `stock.receive`, `stock.return`, `stock.transfer`, `stock.adjust`) |
| GET | `/inventory/movements/:movementId` | `movement.read` |
| POST | `/inventory/movements/:movementId/reverse` | `movement.reverse` |
| POST | `/inventory/movements/:movementId/approve`, `/reject` | `stock.adjust.approve` (Super Admin only) + facility access (not your own request) |
| GET, POST | `/machines` | `machine.read` / `movement.create` |
| GET, POST | `/users` | `user.read` / `user.manage` |
| PATCH | `/users/:userId` | `user.manage` |
| PUT | `/users/:userId/access` | `user.manage` + scope |
| GET, PATCH | `/settings` | `settings.read` / `settings.manage` |
| GET | `/notifications` | authenticated (own notifications only) |
| POST | `/notifications/read-all`, `/notifications/:id/read` | authenticated (own only) |

### Admin safeguards

- **Only Super Admins create Inventory Admins** and assign their facilities. Super Admins themselves are provisioned out of band (seed), never through the API.
- **Inventory Admins only create Users**, and only for departments inside their granted facilities. Department ids outside that scope are refused with `403` before anything is written.
- **Inventory Admins only manage Users in their scope** — listing, editing, password reset and access changes are limited to Users holding at least one in-scope department. Grants a User holds in other admins' departments are left untouched when access is changed.
- **Self-protection** — you cannot deactivate your own account or change your own access.
- Every change writes an audit event (`user.*`, `facility.*`, `department.*`, `project.*`, `settings.*`); passwords are never logged.

## Roles

Exactly three roles, defined in `src/lib/authz/permissions.ts`
(`ROLE_PERMISSIONS`). They are fixed in code, not configurable at runtime.

| Role | Can do | Scope |
|---|---|---|
| `SUPER_ADMIN` | Everything: create Inventory Admins and Users, facilities, departments; all inventory transactions, tools, settings; **the only role that approves stock adjustments** | Unrestricted |
| `INVENTORY_ADMIN` | Create and edit tools; create Users; project CRUD; post stock movements and reverse them; **request** stock adjustments (held for a Super Admin to approve) | Facilities in `InventoryAdminFacility` and the departments/projects beneath them |
| `USER` | View facilities, departments, projects, tools, stock and movements | Departments in `UserDepartmentAccess` (and their projects/facilities) |

There is no operator role. Adjustment approval needs a second person by design: only
`SUPER_ADMIN` holds `stock.adjust.approve`, and nobody can approve their own request.

## Authorization scope model

`getRequestContext()` resolves the role and scope on every request:

- `SUPER_ADMIN` → `unrestricted`.
- `INVENTORY_ADMIN` → facilities from `InventoryAdminFacility`; departments are
  all departments in those facilities; projects are those departments' projects.
- `USER` → departments from `UserDepartmentAccess`; facilities are those
  departments' facilities; projects are those departments' projects.

An empty grant set means **no access** (never "everything"). Guards:
`assertFacilityAccess`, `assertDepartmentAccess`, `assertProjectAccess` and the
`facilityIdFilter` / `departmentIdFilter` / `projectIdFilter` query helpers in
`src/lib/authz/authorize.ts`. `requireFacilityContext` re-checks the selected
facility on every request, so revoking a grant takes effect immediately.
Projects with no department are visible and manageable by Super Admins only.

### One scope helper

Tool visibility is defined once, in `toolScopeWhere` (`src/lib/authz/authorize.ts`): the selected
project, else department, else facility, always intersected with the caller's grants. Everything
else builds on it, so the dashboard list, summary cards, tool detail/edit/deactivate
(`requireToolInScope`), tool history, balances, movement history (`movementScopeWhere`),
posting, approval and reversal all agree. Summary and stock-filter counts aggregate the same
scope in SQL (`src/lib/inventory/stock.ts`). Hidden resources answer `404`, so ids cannot be probed.
