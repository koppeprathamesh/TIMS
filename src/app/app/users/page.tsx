"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiClient, ApiError } from "@/lib/apiClient";
import { ROLE_LABELS, useAccess, type RoleCode } from "@/lib/usePermissions";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Alert } from "@/components/ui/Alert";
import { Field, Input, Select } from "@/components/ui/Input";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { Skeleton } from "@/components/ui/Skeleton";

interface UserRow {
  id: string;
  email: string;
  displayName: string;
  role: RoleCode;
  status: string;
  facilities: { id: string; name: string }[];
  departments: { id: string; name: string; facility: { id: string; name: string } }[];
}
interface FacilityOption {
  id: string;
  name: string;
}
interface DepartmentOption {
  id: string;
  name: string;
  facility: { id: string; name: string };
}

type CreatableRole = "INVENTORY_ADMIN" | "USER";

const ROLE_HELP: Record<CreatableRole, string> = {
  USER: "Can view tools and stock in the projects you choose.",
  INVENTORY_ADMIN: "Manages tools, stock movements and users in the plants you choose.",
};

const ROLE_TONE = { SUPER_ADMIN: "processing", INVENTORY_ADMIN: "info", USER: "neutral" } as const;

function errorMessage(err: unknown, fallback: string) {
  return err instanceof ApiError ? err.message : fallback;
}

function toggled(set: Set<string>, id: string) {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function Chip({ checked, onChange, children }: { checked: boolean; onChange: () => void; children: React.ReactNode }) {
  return (
    <label
      className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1 text-sm transition-colors ${
        checked
          ? "border-[var(--color-primary)] bg-[var(--color-primary-soft)] text-[var(--color-primary)]"
          : "border-[var(--color-border)] bg-white hover:border-[var(--color-primary)]"
      }`}
    >
      <input type="checkbox" className="sr-only" checked={checked} onChange={onChange} />
      <span aria-hidden="true">{checked ? "✓" : "+"}</span>
      {children}
    </label>
  );
}

function AccessPicker({
  mode,
  facilities,
  departments,
  selected,
  onChange,
}: {
  mode: "facilities" | "departments";
  facilities: FacilityOption[];
  departments: DepartmentOption[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const heading = mode === "facilities" ? "Plants this admin can manage" : "Projects this user can view";

  const groups = useMemo(() => {
    if (mode === "facilities") return [{ id: "all", name: "", items: facilities.map((f) => ({ id: f.id, name: f.name })) }];
    const byFacility = new Map<string, { id: string; name: string; items: { id: string; name: string }[] }>();
    for (const d of departments) {
      const group = byFacility.get(d.facility.id) ?? { id: d.facility.id, name: d.facility.name, items: [] };
      group.items.push({ id: d.id, name: d.name });
      byFacility.set(d.facility.id, group);
    }
    return [...byFacility.values()];
  }, [mode, facilities, departments]);

  const allIds = groups.flatMap((g) => g.items.map((i) => i.id));

  return (
    <fieldset className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <legend className="text-sm font-medium">
          {heading} <span className="text-[var(--color-text-muted)]">({selected.size} selected)</span>
        </legend>
        {allIds.length > 0 && (
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => onChange(new Set(allIds))}>Select all</Button>
            <Button size="sm" variant="ghost" onClick={() => onChange(new Set())} disabled={selected.size === 0}>Clear</Button>
          </div>
        )}
      </div>
      {allIds.length === 0 && (
        <p className="text-sm text-[var(--color-text-muted)]">
          No {mode} available.
        </p>
      )}
      {groups.map((group) => (
        <div key={group.id} className="space-y-1.5">
          {group.name && <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{group.name}</p>}
          <div className="flex flex-wrap gap-2">
            {group.items.map((item) => (
              <Chip key={item.id} checked={selected.has(item.id)} onChange={() => onChange(toggled(selected, item.id))}>
                {item.name}
              </Chip>
            ))}
          </div>
        </div>
      ))}
    </fieldset>
  );
}

function RoleCard({
  role,
  active,
  onSelect,
}: {
  role: CreatableRole;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <label
      className={`flex cursor-pointer flex-col gap-1 rounded-[var(--radius-card)] border p-3 transition-colors ${
        active ? "border-[var(--color-primary)] bg-[var(--color-primary-soft)]" : "border-[var(--color-border)] bg-white hover:border-[var(--color-primary)]"
      }`}
    >
      <span className="flex items-center gap-2 text-sm font-semibold">
        <input type="radio" name="new-user-role" checked={active} onChange={onSelect} />
        {ROLE_LABELS[role]}
      </span>
      <span className="pl-6 text-xs text-[var(--color-text-muted)]">{ROLE_HELP[role]}</span>
    </label>
  );
}

function CreateUserPanel({
  isSuperAdmin,
  facilities,
  departments,
  onCreate,
  onClose,
}: {
  isSuperAdmin: boolean;
  facilities: FacilityOption[];
  departments: DepartmentOption[];
  onCreate: (payload: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
}) {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<CreatableRole>("USER");
  const [selectedFacilities, setSelectedFacilities] = useState<Set<string>>(new Set());
  const [selectedDepartments, setSelectedDepartments] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Inventory Admins can only create Users.
  const effectiveRole: CreatableRole = isSuperAdmin ? role : "USER";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await onCreate({
        email,
        displayName,
        password,
        role: effectiveRole,
        facilityIds: effectiveRole === "INVENTORY_ADMIN" ? [...selectedFacilities] : [],
        departmentIds: effectiveRole === "USER" ? [...selectedDepartments] : [],
      });
      onClose();
    } catch (err) {
      setError(errorMessage(err, "Unable to create the user."));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card mb-6 divide-y divide-[var(--color-border)]" aria-label="Create user">
      <div className="flex items-center justify-between p-5">
        <div>
          <h2 className="text-lg font-semibold">{isSuperAdmin ? "Add a new user" : "Add a user"}</h2>
          <p className="text-sm text-[var(--color-text-muted)]">Create the account, choose a role and grant access.</p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">✕</Button>
      </div>

      <section className="space-y-4 p-5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">1 · Account details</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Full name" required>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="e.g. Ravi Kumar" maxLength={100} />
          </Field>
          <Field label="Email" required hint="Must be a company address (@etgroupindia.com).">
            <Input type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@etgroupindia.com" />
          </Field>
          <Field label="Initial password" required hint="At least 10 characters with a letter and a digit. The user can change it via Forgot password.">
            <PasswordInput autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Initial password" />
          </Field>
        </div>
      </section>

      <section className="space-y-3 p-5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">2 · Role</h3>
        {isSuperAdmin ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <RoleCard role="USER" active={role === "USER"} onSelect={() => setRole("USER")} />
            <RoleCard role="INVENTORY_ADMIN" active={role === "INVENTORY_ADMIN"} onSelect={() => setRole("INVENTORY_ADMIN")} />
          </div>
        ) : (
          <p className="text-sm text-[var(--color-text-muted)]">New accounts are created with the {ROLE_LABELS.USER} role.</p>
        )}
      </section>

      <section className="space-y-3 p-5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">3 · Access</h3>
        {effectiveRole === "INVENTORY_ADMIN" ? (
          <AccessPicker mode="facilities" facilities={facilities} departments={departments} selected={selectedFacilities} onChange={setSelectedFacilities} />
        ) : (
          <AccessPicker mode="departments" facilities={facilities} departments={departments} selected={selectedDepartments} onChange={setSelectedDepartments} />
        )}
      </section>

      <div className="space-y-3 p-5">
        {error && <Alert>{error}</Alert>}
        <div className="flex gap-3">
          <Button type="submit" disabled={busy}>
            {busy ? "Creating…" : effectiveRole === "INVENTORY_ADMIN" ? "Create Inventory Admin" : "Create user"}
          </Button>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        </div>
      </div>
    </form>
  );
}

export default function UsersPage() {
  const access = useAccess();
  const canManage = access?.permissions.has("user.manage") ?? false;
  const isSuperAdmin = access?.role === "SUPER_ADMIN";

  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [facilities, setFacilities] = useState<FacilityOption[]>([]);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<"" | RoleCode>("");
  const [statusFilter, setStatusFilter] = useState<"" | "ACTIVE" | "INACTIVE">("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editSelection, setEditSelection] = useState<Set<string>>(new Set());
  const [resetId, setResetId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState("");

  const load = useCallback(() => {
    apiClient
      .get<{ data: UserRow[] }>("/users")
      .then((r) => {
        setUsers(r.data);
        setError(null);
      })
      .catch((err) => setError(errorMessage(err, "Failed to load users.")));
  }, []);

  useEffect(() => {
    load();
    // Both lists are already limited server-side to what the signed-in user may assign.
    apiClient.get<{ data: FacilityOption[] }>("/facilities").then((r) => setFacilities(r.data)).catch(() => {});
    apiClient.get<{ data: DepartmentOption[] }>("/departments?all=true").then((r) => setDepartments(r.data)).catch(() => {});
  }, [load]);

  const filtered = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return (users ?? []).filter((u) => {
      if (roleFilter && u.role !== roleFilter) return false;
      if (statusFilter && u.status !== statusFilter) return false;
      if (terms.length === 0) return true;
      const haystack = [
        u.displayName,
        u.email,
        ROLE_LABELS[u.role] ?? u.role,
        ...u.facilities.map((f) => f.name),
        ...u.departments.map((d) => `${d.facility.name} ${d.name}`),
      ]
        .join(" ")
        .toLowerCase();
      return terms.every((t) => haystack.includes(t));
    });
  }, [users, query, roleFilter, statusFilter]);

  const filtersActive = Boolean(query.trim() || roleFilter || statusFilter);

  async function run(action: () => Promise<unknown>, success: string) {
    setError(null);
    setMessage(null);
    try {
      await action();
      setMessage(success);
      load();
    } catch (err) {
      setError(errorMessage(err, "The action failed."));
    }
  }

  async function createUser(payload: Record<string, unknown>) {
    await apiClient.post("/users", payload);
    setMessage("User created.");
    setError(null);
    load();
  }

  function startEditAccess(user: UserRow) {
    setEditingId(user.id);
    setResetId(null);
    setEditSelection(
      new Set(user.role === "INVENTORY_ADMIN" ? user.facilities.map((f) => f.id) : user.departments.map((d) => d.id))
    );
  }

  function accessSummary(u: UserRow) {
    if (u.role === "SUPER_ADMIN") return "All plants";
    if (u.role === "INVENTORY_ADMIN") return u.facilities.map((f) => f.name).join(", ") || "—";
    return u.departments.map((d) => `${d.facility.name} / ${d.name}`).join(", ") || "—";
  }

  return (
    <div className="mx-auto max-w-6xl px-2 py-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-heading text-2xl font-semibold">Users</h1>
          <p className="text-sm text-[var(--color-text-muted)]">
            {users === null ? "Loading users…" : `${users.length} ${users.length === 1 ? "user" : "users"} in your organisation`}
          </p>
        </div>
        {canManage && !showCreate && <Button onClick={() => setShowCreate(true)}>➕ Add user</Button>}
      </div>

      {error && <div className="mb-3"><Alert>{error}</Alert></div>}
      {message && <p role="status" className="mb-3 text-sm text-[var(--color-success)]">{message}</p>}

      {canManage && showCreate && (
        <CreateUserPanel
          isSuperAdmin={isSuperAdmin}
          facilities={facilities}
          departments={departments}
          onCreate={createUser}
          onClose={() => setShowCreate(false)}
        />
      )}

      <div className="card p-4">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="min-w-[16rem] flex-1">
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, email, role, plant or project"
              aria-label="Search users"
            />
          </div>
          <div className="w-44">
            <Select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as "" | RoleCode)} aria-label="Filter by role">
              <option value="">All roles</option>
              <option value="SUPER_ADMIN">{ROLE_LABELS.SUPER_ADMIN}</option>
              <option value="INVENTORY_ADMIN">{ROLE_LABELS.INVENTORY_ADMIN}</option>
              <option value="USER">{ROLE_LABELS.USER}</option>
            </Select>
          </div>
          <div className="w-36">
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as "" | "ACTIVE" | "INACTIVE")} aria-label="Filter by status">
              <option value="">All statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </Select>
          </div>
          {filtersActive && (
            <Button variant="ghost" size="sm" onClick={() => { setQuery(""); setRoleFilter(""); setStatusFilter(""); }}>
              Clear filters
            </Button>
          )}
        </div>

        {users === null && !error && <Skeleton className="h-40 w-full" />}
        {users && filtersActive && (
          <p className="mb-2 text-xs text-[var(--color-text-muted)]" aria-live="polite">
            Showing {filtered.length} of {users.length}
          </p>
        )}
        {users && filtered.length === 0 && (
          <p className="py-8 text-center text-sm text-[var(--color-text-muted)]">
            {filtersActive ? "No users match your search." : "No users yet."}
          </p>
        )}
        {users && filtered.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-xs uppercase text-[var(--color-text-muted)]">
                  <th scope="col" className="py-2 pr-3">User</th>
                  <th scope="col" className="py-2 pr-3">Role</th>
                  <th scope="col" className="py-2 pr-3">Access</th>
                  <th scope="col" className="py-2 pr-3">Status</th>
                  {canManage && <th scope="col" className="py-2 pr-3">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => (
                  <tr key={u.id} className="border-b border-[var(--color-border)] align-top">
                    <td className="py-3 pr-3">
                      <div className="flex items-center gap-3">
                        <span
                          aria-hidden="true"
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary-soft)] text-xs font-semibold text-[var(--color-primary)]"
                        >
                          {initials(u.displayName)}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-medium">{u.displayName}</p>
                          <p className="truncate text-xs text-[var(--color-text-muted)]">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 pr-3"><Badge tone={ROLE_TONE[u.role] ?? "neutral"}>{ROLE_LABELS[u.role] ?? u.role}</Badge></td>
                    <td className="max-w-xs py-3 pr-3 text-[var(--color-text-muted)]">{accessSummary(u)}</td>
                    <td className="py-3 pr-3"><Badge tone={u.status === "ACTIVE" ? "success" : "neutral"}>{u.status === "ACTIVE" ? "Active" : "Inactive"}</Badge></td>
                    {canManage && (
                      <td className="py-3 pr-3">
                        <div className="flex flex-wrap gap-2">
                          {u.role !== "SUPER_ADMIN" && (
                            <Button size="sm" variant="secondary" onClick={() => startEditAccess(u)}>Access</Button>
                          )}
                          <Button size="sm" variant="secondary" onClick={() => { setResetId(u.id); setResetPassword(""); setEditingId(null); }}>
                            Reset password
                          </Button>
                          <Button
                            size="sm"
                            variant={u.status === "ACTIVE" ? "danger" : "secondary"}
                            onClick={() =>
                              run(
                                () => apiClient.patch(`/users/${u.id}`, { status: u.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" }),
                                u.status === "ACTIVE" ? "User deactivated." : "User activated."
                              )
                            }
                          >
                            {u.status === "ACTIVE" ? "Deactivate" : "Activate"}
                          </Button>
                        </div>

                        {editingId === u.id && (
                          <div className="mt-3 space-y-3 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
                            <AccessPicker
                              mode={u.role === "INVENTORY_ADMIN" ? "facilities" : "departments"}
                              facilities={facilities}
                              departments={departments}
                              selected={editSelection}
                              onChange={setEditSelection}
                            />
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                onClick={() =>
                                  run(async () => {
                                    await apiClient.put(
                                      `/users/${u.id}/access`,
                                      u.role === "INVENTORY_ADMIN"
                                        ? { facilityIds: [...editSelection] }
                                        : { departmentIds: [...editSelection] }
                                    );
                                    setEditingId(null);
                                  }, "Access updated.")
                                }
                              >
                                Save access
                              </Button>
                              <Button size="sm" variant="secondary" onClick={() => setEditingId(null)}>Cancel</Button>
                            </div>
                          </div>
                        )}

                        {resetId === u.id && (
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            <div className="w-64">
                              <PasswordInput
                                autoComplete="new-password"
                                value={resetPassword}
                                onChange={(e) => setResetPassword(e.target.value)}
                                placeholder="New password"
                                aria-label="New password"
                              />
                            </div>
                            <Button
                              size="sm"
                              onClick={() =>
                                run(async () => {
                                  await apiClient.patch(`/users/${u.id}`, { password: resetPassword });
                                  setResetId(null);
                                  setResetPassword("");
                                }, "Password reset.")
                              }
                            >
                              Set password
                            </Button>
                            <Button size="sm" variant="secondary" onClick={() => setResetId(null)}>Cancel</Button>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
