"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiClient, ApiError } from "@/lib/apiClient";
import { accessStore, useAccess } from "@/lib/usePermissions";
import EntityCard from "@/components/cards/EntityCard";
import { Emoji } from "@/components/ui/Emoji";
import ScopeBar from "@/components/layout/ScopeBar";
import EntityForm from "@/components/forms/EntityForm";
import EmptyState from "@/components/feedback/EmptyState";
import { Alert } from "@/components/ui/Alert";
import { Button, LinkButton } from "@/components/ui/Button";
import { CardGridSkeleton } from "@/components/ui/Skeleton";

interface Department {
  id: string;
  name: string;
  imageUrl: string | null;
}

// Step 2: choose a department of the selected facility. Only a Super Admin can add one.
export default function DepartmentSelectionPage() {
  const router = useRouter();
  const access = useAccess();
  const facility = access?.session.facility ?? null;
  const canCreate = access?.role === "SUPER_ADMIN" && access.permissions.has("department.manage");

  const [departments, setDepartments] = useState<Department[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (access && !facility) router.replace("/app/workspace");
  }, [access, facility, router]);

  const load = useCallback(() => {
    if (!facility) return;
    apiClient
      .get<{ data: Department[] }>(`/departments?facilityId=${encodeURIComponent(facility.id)}`)
      .then((res) => {
        setDepartments(res.data);
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load projects."));
  }, [facility]);

  useEffect(load, [load]);

  async function selectDepartment(department: Department) {
    setError(null);
    setBusy(true);
    try {
      await apiClient.post("/context", { departmentId: department.id });
      await accessStore.refresh();
      router.push("/app/projects");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to open this project.");
    } finally {
      // The page can be kept alive in history, so a stuck flag would leave the cards disabled on return.
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-2 py-6">
      <LinkButton href="/app/workspace" variant="secondary" size="sm">
        ← Back to Plants
      </LinkButton>
      <div className="mb-4 mt-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-heading text-3xl font-bold"><Emoji className="mr-2">🏢</Emoji>Select Project</h1>
          <div className="mt-2">
            {facility ? <ScopeBar levels={["facility"]} /> : null}
          </div>
          <p className="mt-2 text-base text-[var(--color-text-muted)]">Choose your project within the plant.</p>
        </div>
        {canCreate && facility && (
          <Button onClick={() => setShowCreate((v) => !v)} aria-expanded={showCreate}>
            {showCreate ? "Close" : "➕ Add Project"}
          </Button>
        )}
      </div>

      {error && <Alert className="mb-3">{error}</Alert>}
      {message && <Alert tone="success" className="mb-3">{message}</Alert>}

      {canCreate && facility && showCreate && (
        <div className="mb-5">
          <EntityForm
            label="New project"
            showCode
            submitLabel="Create project"
            onSubmit={async (v) => {
              setError(null);
              setMessage(null);
              try {
                await apiClient.post("/departments", {
                  facilityId: facility.id,
                  name: v.name,
                  code: v.code,
                  description: v.description || null,
                  imageUrl: v.imageUrl || null,
                });
                setMessage("Project created.");
                setShowCreate(false);
                load();
              } catch (err) {
                setError(err instanceof ApiError ? err.message : "Could not create the project.");
                throw err;
              }
            }}
          />
        </div>
      )}

      {departments === null && !error && <CardGridSkeleton count={4} className="sm:grid-cols-2" />}
      {departments && departments.length === 0 && (
        <EmptyState
          title="No projects"
          message={canCreate ? "Add the first project to this plant." : "You have not been given access to any project in this plant."}
        />
      )}
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {departments?.map((d) => (
          <li key={d.id}>
            <EntityCard title={d.name} imageUrl={d.imageUrl} onClick={() => selectDepartment(d)} disabled={busy} />
          </li>
        ))}
      </ul>
    </div>
  );
}
