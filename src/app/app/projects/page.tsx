"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiClient, ApiError } from "@/lib/apiClient";
import { accessStore, useAccess } from "@/lib/usePermissions";
import { recordStatusLabel } from "@/lib/labels";
import { Badge } from "@/components/ui/Badge";
import { Button, LinkButton } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Field, Input } from "@/components/ui/Input";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { CardGridSkeleton } from "@/components/ui/Skeleton";
import { Emoji } from "@/components/ui/Emoji";
import ScopeBar from "@/components/layout/ScopeBar";

interface Project {
  id: string;
  code: string;
  name: string;
  status: string;
}

const errorMessage = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

export default function ProjectsPage() {
  const router = useRouter();
  const access = useAccess();
  const session = access?.session;
  const department = session?.department ?? null;
  const canCreate = access?.permissions.has("project.create") ?? false;
  const canUpdate = access?.permissions.has("project.update") ?? false;
  const canDelete = access?.permissions.has("project.archive") ?? false;

  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [formErrors, setFormErrors] = useState<{ name?: string }>({});
  const [creating, setCreating] = useState(false);

  const [editing, setEditing] = useState<Project | null>(null);
  const [editName, setEditName] = useState("");
  const [deleting, setDeleting] = useState<Project | null>(null);

  // Projects are always listed for the department chosen on the previous step.
  useEffect(() => {
    if (access && !department) router.replace(session?.facility ? "/app/workspace/departments" : "/app/workspace");
  }, [access, department, session?.facility, router]);

  const load = useCallback(() => {
    if (!department) return;
    apiClient
      .get<{ data: Project[] }>(`/projects?includeArchived=true&departmentId=${encodeURIComponent(department.id)}`)
      .then((res) => {
        setProjects(res.data);
        setError(null);
      })
      .catch((err) => setError(errorMessage(err, "Failed to load parts.")));
  }, [department]);

  useEffect(load, [load]);

  // With no projects yet, the form is the obvious next step.
  const formOpen = canCreate && (showForm || projects?.length === 0);
  const query = search.trim().toLowerCase();
  const visibleProjects = projects?.filter((p) => !query || p.name.toLowerCase().includes(query) || p.code.toLowerCase().includes(query));

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!department) return;
    const errors: typeof formErrors = {};
    if (!name.trim()) errors.name = "Enter a part name.";
    setFormErrors(errors);
    if (Object.keys(errors).length) return;

    setError(null);
    setCreating(true);
    try {
      await apiClient.post("/projects", { departmentId: department.id, name: name.trim() });
      setName("");
      setShowForm(false);
      setMessage("Part created.");
      load();
    } catch (err) {
      setError(errorMessage(err, "Unable to create part."));
    } finally {
      setCreating(false);
    }
  }

  async function run(id: string, action: () => Promise<unknown>, success: string) {
    setError(null);
    setMessage(null);
    setBusyId(id);
    try {
      await action();
      setMessage(success);
      load();
    } catch (err) {
      setError(errorMessage(err, "The action failed."));
    } finally {
      setBusyId(null);
    }
  }

  // Makes the project the working project and opens its dashboard.
  async function openProject(project: Project) {
    setError(null);
    setBusyId(project.id);
    try {
      await apiClient.post("/context", { projectId: project.id });
      await accessStore.refresh();
      router.push("/app/dashboard");
    } catch (err) {
      setError(errorMessage(err, "Unable to open this part."));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-2 py-6">
      <LinkButton href="/app/workspace/departments" variant="secondary" size="sm">
        ← Back to Projects
      </LinkButton>
      <div className="mb-4 mt-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-heading text-3xl font-bold"><Emoji className="mr-2">📁</Emoji>Select a Part</h1>
          <div className="mt-2">
            <ScopeBar levels={["facility", "department"]} />
          </div>
          <p className="mt-2 text-base text-[var(--color-text-muted)]">Choose a part to open its dashboard.</p>
        </div>
        {canCreate && (
          <Button size="md" onClick={() => setShowForm(!formOpen)} aria-expanded={formOpen} className="px-5 py-2.5">
            {formOpen ? "Close" : "➕ Add part"}
          </Button>
        )}
      </div>

      {error && <Alert className="mb-3">{error}</Alert>}
      {message && <Alert tone="success" className="mb-3">{message}</Alert>}

      {formOpen && (
        <form onSubmit={handleCreate} className="card mb-5 space-y-4 border-[var(--color-primary)] p-5" aria-label="Create part" noValidate>
          <h2 className="text-lg font-semibold">New part</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Part name" required error={formErrors.name}>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={creating}>{creating ? "Creating…" : "Create part"}</Button>
            <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
          </div>
        </form>
      )}

      {projects && projects.length > 0 && (
        <div className="mb-4 max-w-md">
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search parts…"
            aria-label="Search parts"
          />
        </div>
      )}

      {projects === null && !error && <CardGridSkeleton count={4} className="sm:grid-cols-2" />}
      {projects && projects.length === 0 && (
        <div className="card p-8 text-center">
          <h2 className="text-base font-semibold">No parts yet</h2>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            {canCreate ? "Create the first part to start adding tools." : "Parts you are given access to will appear here."}
          </p>
        </div>
      )}
      {visibleProjects && projects && projects.length > 0 && visibleProjects.length === 0 && (
        <p className="text-sm text-[var(--color-text-muted)]">No parts match your search.</p>
      )}

      {visibleProjects && visibleProjects.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2">
          {visibleProjects.map((p) => {
            const active = p.status === "ACTIVE";
            const busy = busyId === p.id;
            const details = (
              <>
                <span className="block break-words text-xl font-semibold"><Emoji className="mr-2">📁</Emoji>{p.name}</span>
                <span className="mt-1 block text-base text-[var(--color-text-muted)]">{p.code}</span>
              </>
            );
            return (
              <li key={p.id} className="card flex flex-col">
                {active ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => openProject(p)}
                    aria-label={`Open part ${p.name} (${p.code})`}
                    className="w-full rounded-t-[var(--radius-card)] p-4 text-left hover:bg-[var(--color-surface-muted)] disabled:opacity-60"
                  >
                    {details}
                  </button>
                ) : (
                  <div className="p-4">
                    {details}
                    <div className="mt-2"><Badge tone="neutral">{recordStatusLabel(p.status)}</Badge></div>
                  </div>
                )}
                {(canUpdate || canDelete) && (
                  <div className="mt-auto flex flex-wrap gap-2 border-t border-[var(--color-border)] px-4 py-2">
                    {canUpdate && (
                      <Button size="sm" variant="secondary" disabled={busy} onClick={() => { setEditing(p); setEditName(p.name); }}>
                        ✏️ Edit
                      </Button>
                    )}
                    {canDelete && (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy}
                        onClick={() =>
                          run(p.id, () => apiClient.patch(`/projects/${p.id}`, { status: active ? "ARCHIVED" : "ACTIVE" }), active ? "Part archived." : "Part restored.")
                        }
                      >
                        {active ? "📦 Archive" : "♻️ Restore"}
                      </Button>
                    )}
                    {canDelete && (
                      <Button size="sm" variant="danger" disabled={busy} onClick={() => setDeleting(p)}>
                        🗑️ Delete
                      </Button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!canUpdate && !canDelete && projects && projects.length > 0 && (
        <p className="mt-3 text-xs text-[var(--color-text-muted)]">You have view-only access to the parts in your assigned projects.</p>
      )}

      <ConfirmDialog
        open={Boolean(editing)}
        title={editing ? `Rename ${editing.code}` : ""}
        confirmLabel="Save"
        onCancel={() => setEditing(null)}
        onConfirm={() => {
          const target = editing;
          if (!target || !editName.trim()) return;
          setEditing(null);
          void run(target.id, () => apiClient.patch(`/projects/${target.id}`, { name: editName.trim() }), "Part updated.");
        }}
      >
        <Field label="Part name" required>
          <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
        </Field>
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete part?"
        confirmLabel="Delete"
        destructive
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          const target = deleting;
          if (!target) return;
          setDeleting(null);
          void run(target.id, () => apiClient.delete(`/projects/${target.id}`), "Part deleted.");
        }}
      >
        {deleting && <>Delete part <strong>{deleting.name}</strong> ({deleting.code})? This cannot be undone. Parts with tools or movements cannot be deleted; archive them instead.</>}
      </ConfirmDialog>
    </div>
  );
}
