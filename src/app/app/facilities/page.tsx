"use client";

import { useCallback, useEffect, useState } from "react";
import { apiClient, ApiError } from "@/lib/apiClient";
import { useAccess } from "@/lib/usePermissions";
import EntityCard from "@/components/cards/EntityCard";
import EntityForm from "@/components/forms/EntityForm";
import EmptyState from "@/components/feedback/EmptyState";

interface Facility {
  id: string;
  name: string;
  code: string;
  description: string | null;
  imageUrl: string | null;
  status: string;
  _count: { departments: number };
}

export default function FacilitiesPage() {
  const access = useAccess();
  const canManage = access?.permissions.has("facility.manage") ?? false;

  const [facilities, setFacilities] = useState<Facility[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(() => {
    apiClient
      .get<{ data: Facility[] }>("/facilities?includeInactive=true")
      .then((r) => {
        setFacilities(r.data);
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load plants."));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="mx-auto max-w-6xl px-2 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="page-heading text-2xl font-semibold">Plant administration</h1>
        {canManage && (
          <button className="btn-primary px-4 py-2 text-sm" onClick={() => setShowCreate((v) => !v)}>
            {showCreate ? "Close" : "New plant"}
          </button>
        )}
      </div>
      <p className="mb-6 text-sm text-[var(--color-text-muted)]">
        Super Admin only. Create and maintain plant records, then open a plant to manage its projects.
        These cards open administration; they do not select your working plant.
      </p>

      {error && <p role="alert" className="mb-3 text-sm text-[var(--color-danger)]">{error}</p>}
      {message && <p role="status" className="mb-3 text-sm text-[var(--color-success)]">{message}</p>}

      {canManage && showCreate && (
        <div className="mb-4">
          <EntityForm
            label="New plant"
            showCode
            submitLabel="Create plant"
            onSubmit={async (v) => {
              setError(null);
              setMessage(null);
              try {
                await apiClient.post("/facilities", {
                  name: v.name,
                  code: v.code,
                  description: v.description || null,
                  imageUrl: v.imageUrl || null,
                });
                setMessage("Plant created.");
                setShowCreate(false);
                load();
              } catch (err) {
                setError(err instanceof ApiError ? err.message : "Could not create the plant.");
                throw err;
              }
            }}
          />
        </div>
      )}

      {facilities === null && !error && <p className="text-sm text-[var(--color-text-muted)]">Loading…</p>}
      {facilities && facilities.length === 0 && (
        <EmptyState
          title="No plants"
          message="You have no plants in your scope."
          action={
            canManage ? (
              <button className="btn-primary px-4 py-2 text-sm" onClick={() => setShowCreate(true)}>
                Add Plant
              </button>
            ) : null
          }
        />
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {facilities?.map((f) => (
          <EntityCard
            key={f.id}
            href={`/app/facilities/${f.id}`}
            title={f.name}
            subtitle={`${f.code} · ${f._count.departments} project${f._count.departments === 1 ? "" : "s"}`}
            description={f.description}
            imageUrl={f.imageUrl}
            badge={f.status === "ACTIVE" ? undefined : "Inactive"}
            actionLabel="Manage plant and projects"
          />
        ))}
      </div>
    </div>
  );
}
