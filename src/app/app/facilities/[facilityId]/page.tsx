"use client";

import { useCallback, useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
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
}
interface Department {
  id: string;
  name: string;
  code: string;
  description: string | null;
  imageUrl: string | null;
  status: string;
  _count: { projects: number };
}

export default function FacilityDetailPage() {
  return (
    <Suspense fallback={null}>
      <FacilityDetail />
    </Suspense>
  );
}

function FacilityDetail() {
  const { facilityId } = useParams<{ facilityId: string }>();
  const access = useAccess();
  const canManageFacility = access?.permissions.has("facility.manage") ?? false;
  const canManageDepartments = access?.permissions.has("department.manage") ?? false;

  const [facility, setFacility] = useState<Facility | null>(null);
  const [departments, setDepartments] = useState<Department[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editingFacility, setEditingFacility] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [editingDepartmentId, setEditingDepartmentId] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([
      apiClient.get<{ data: Facility[] }>("/facilities?includeInactive=true"),
      apiClient.get<{ data: Department[] }>(`/departments?facilityId=${facilityId}&includeInactive=true`),
    ])
      .then(([f, d]) => {
        const found = f.data.find((x) => x.id === facilityId);
        if (!found) throw new ApiError(404, "NOT_FOUND", "Plant not found in your organization.");
        setFacility(found);
        setDepartments(d.data);
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load this plant."));
  }, [facilityId]);

  useEffect(() => {
    load();
  }, [load]);

  async function save(action: () => Promise<unknown>, success: string, fallback: string) {
    setError(null);
    setMessage(null);
    try {
      await action();
      setMessage(success);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : fallback);
      throw err;
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-2 py-6">
      <Link href="/app/facilities" className="text-sm text-[var(--color-primary)] hover:underline">
        ← Plant administration
      </Link>
      <h1 className="page-heading mt-3 text-2xl font-semibold">Manage plant and projects</h1>
      <p className="mt-1 text-sm text-[var(--color-text-muted)]">
        Administration only. Changes here update organization records, not your workspace selection.
      </p>

      {error && <p role="alert" className="mt-3 text-sm text-[var(--color-danger)]">{error}</p>}
      {message && <p role="status" className="mt-3 text-sm text-[var(--color-success)]">{message}</p>}
      {!facility && !error && <p className="mt-3 text-sm text-[var(--color-text-muted)]">Loading…</p>}

      {facility && (
        <>
          <div className="mt-3 grid gap-4 md:grid-cols-[minmax(0,20rem)_1fr]">
            <EntityCard
              title={facility.name}
              subtitle={facility.code}
              description={facility.description}
              imageUrl={facility.imageUrl}
              badge={facility.status === "ACTIVE" ? undefined : "Inactive"}
            />
            {canManageFacility && (
              <div className="space-y-3">
                {editingFacility ? (
                  <EntityForm
                    label="Edit plant"
                    showCode={false}
                    initial={{
                      name: facility.name,
                      description: facility.description ?? "",
                      imageUrl: facility.imageUrl ?? "",
                    }}
                    submitLabel="Save plant"
                    onCancel={() => setEditingFacility(false)}
                    onSubmit={async (v) => {
                      await save(
                        () =>
                          apiClient.patch(`/facilities/${facility.id}`, {
                            name: v.name,
                            description: v.description || null,
                            imageUrl: v.imageUrl || null,
                          }),
                        "Plant updated.",
                        "Could not update the plant."
                      );
                      setEditingFacility(false);
                    }}
                  />
                ) : (
                  <div className="flex flex-wrap gap-3">
                    <button className="btn-primary px-4 py-2 text-sm" onClick={() => setEditingFacility(true)}>
                      Edit plant
                    </button>
                    <button
                      className="text-sm text-[var(--color-danger)] hover:underline"
                      onClick={() =>
                        save(
                          () =>
                            apiClient.patch(`/facilities/${facility.id}`, {
                              status: facility.status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
                            }),
                          facility.status === "ACTIVE" ? "Plant deactivated." : "Plant activated.",
                          "Could not change the plant status."
                        ).catch(() => {})
                      }
                    >
                      {facility.status === "ACTIVE" ? "Deactivate" : "Activate"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="mb-4 mt-8 flex items-center justify-between">
            <h2 className="page-heading text-xl font-semibold">Projects</h2>
            {canManageDepartments && (
              <button className="btn-primary px-4 py-2 text-sm" onClick={() => setShowCreate((v) => !v)}>
                {showCreate ? "Close" : "New project"}
              </button>
            )}
          </div>

          {canManageDepartments && showCreate && (
            <div className="mb-4">
              <EntityForm
                label="New project"
                showCode
                submitLabel="Create project"
                onSubmit={async (v) => {
                  await save(
                    () =>
                      apiClient.post("/departments", {
                        facilityId: facility.id,
                        name: v.name,
                        code: v.code,
                        description: v.description || null,
                        imageUrl: v.imageUrl || null,
                      }),
                    "Project created.",
                    "Could not create the project."
                  );
                  setShowCreate(false);
                }}
              />
            </div>
          )}

          {departments && departments.length === 0 && (
            <EmptyState
              title="No projects"
              message="This plant has no projects yet."
              action={
                canManageDepartments ? (
                  <button className="btn-primary px-4 py-2 text-sm" onClick={() => setShowCreate(true)}>
                    Add Project
                  </button>
                ) : null
              }
            />
          )}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {departments?.map((d) =>
              editingDepartmentId === d.id ? (
                <div key={d.id} className="sm:col-span-2 lg:col-span-3">
                  <EntityForm
                    label={`Edit ${d.name}`}
                    showCode={false}
                    initial={{ name: d.name, description: d.description ?? "", imageUrl: d.imageUrl ?? "" }}
                    submitLabel="Save project"
                    onCancel={() => setEditingDepartmentId(null)}
                    onSubmit={async (v) => {
                      await save(
                        () =>
                          apiClient.patch(`/departments/${d.id}`, {
                            name: v.name,
                            description: v.description || null,
                            imageUrl: v.imageUrl || null,
                          }),
                        "Project updated.",
                        "Could not update the project."
                      );
                      setEditingDepartmentId(null);
                    }}
                  />
                </div>
              ) : (
                <EntityCard
                  key={d.id}
                  title={d.name}
                  subtitle={`${d.code} · ${d._count.projects} part${d._count.projects === 1 ? "" : "s"}`}
                  description={d.description}
                  imageUrl={d.imageUrl}
                  badge={d.status === "ACTIVE" ? undefined : "Inactive"}
                  footer={
                    canManageDepartments && (
                      <div className="flex gap-3 text-sm">
                        <button className="hover:underline" onClick={() => setEditingDepartmentId(d.id)}>
                          Edit
                        </button>
                        <button
                          className="text-[var(--color-danger)] hover:underline"
                          onClick={() =>
                            save(
                              () =>
                                apiClient.patch(`/departments/${d.id}`, {
                                  status: d.status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
                                }),
                              d.status === "ACTIVE" ? "Project deactivated." : "Project activated.",
                              "Could not change the project status."
                            ).catch(() => {})
                          }
                        >
                          {d.status === "ACTIVE" ? "Deactivate" : "Activate"}
                        </button>
                      </div>
                    )
                  }
                />
              )
            )}
          </div>
        </>
      )}
    </div>
  );
}
