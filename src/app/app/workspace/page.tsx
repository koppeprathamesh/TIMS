"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiClient, ApiError } from "@/lib/apiClient";
import { accessStore, useAccess } from "@/lib/usePermissions";
import EntityCard from "@/components/cards/EntityCard";
import { Emoji } from "@/components/ui/Emoji";
import EntityForm from "@/components/forms/EntityForm";
import EmptyState from "@/components/feedback/EmptyState";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { CardGridSkeleton } from "@/components/ui/Skeleton";

interface Facility {
  id: string;
  name: string;
  imageUrl: string | null;
}

// Step 1: choose a facility. Only a Super Admin can add one.
export default function WorkspacePage() {
  const router = useRouter();
  const access = useAccess();
  const canCreate = access?.role === "SUPER_ADMIN" && access.permissions.has("facility.manage");

  const [facilities, setFacilities] = useState<Facility[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    apiClient
      .get<{ data: Facility[] }>("/facilities")
      .then((res) => {
        setFacilities(res.data);
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load plants."));
  }, []);

  useEffect(load, [load]);

  async function selectFacility(facility: Facility) {
    setError(null);
    setBusy(true);
    try {
      await apiClient.post("/context", { facilityId: facility.id });
      await accessStore.refresh();
      router.push("/app/workspace/departments");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to open this plant.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-2 py-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-heading text-3xl font-bold"><Emoji className="mr-2">🏭</Emoji>Select Plant</h1>
          <p className="mt-1 text-base text-[var(--color-text-muted)]">Choose the plant you are working in.</p>
        </div>
        {canCreate && (
          <Button onClick={() => setShowCreate((v) => !v)} aria-expanded={showCreate}>
            {showCreate ? "Close" : "➕ Add Plant"}
          </Button>
        )}
      </div>

      {error && <Alert className="mb-3">{error}</Alert>}
      {message && <Alert tone="success" className="mb-3">{message}</Alert>}

      {canCreate && showCreate && (
        <div className="mb-5">
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

      {facilities === null && !error && <CardGridSkeleton count={4} className="sm:grid-cols-2" />}
      {facilities && facilities.length === 0 && (
        <EmptyState
          title="No plants"
          message={canCreate ? "Add the first plant to get started." : "You have not been given access to any plant yet."}
        />
      )}
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {facilities?.map((f) => (
          <li key={f.id}>
            <EntityCard title={f.name} imageUrl={f.imageUrl} onClick={() => selectFacility(f)} disabled={busy} />
          </li>
        ))}
      </ul>
    </div>
  );
}
