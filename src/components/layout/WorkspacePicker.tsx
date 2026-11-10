"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiClient, ApiError } from "@/lib/apiClient";
import { accessStore, useAccess } from "@/lib/usePermissions";
import { workspaceDestination, PROJECTS_PATH } from "@/lib/navigation";
import { Button } from "@/components/ui/Button";
import { Field, Select } from "@/components/ui/Input";
import { Alert } from "@/components/ui/Alert";
import { Skeleton } from "@/components/ui/Skeleton";

interface Option {
  id: string;
  name: string;
}

// Choosing a level resets the ones below it. A level with exactly one option is chosen for the user,
// so most people never see more than the dropdowns that genuinely need a decision.
export default function WorkspacePicker({
  onApplied,
  submitLabel = "Open workspace",
}: {
  onApplied?: () => void;
  submitLabel?: string;
}) {
  const router = useRouter();
  const access = useAccess();
  const current = access?.session;

  const [facilities, setFacilities] = useState<Option[] | null>(null);
  // Lists remember which parent they were loaded for, so a stale list is never shown for a new parent.
  const [departmentList, setDepartmentList] = useState<{ parent: string; items: Option[] } | null>(null);
  const [projectList, setProjectList] = useState<{ parent: string; items: Option[] } | null>(null);
  const [facilityId, setFacilityId] = useState(current?.facility?.id ?? "");
  const [departmentId, setDepartmentId] = useState(current?.department?.id ?? "");
  const [projectId, setProjectId] = useState(current?.project?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const departments = departmentList?.parent === facilityId ? departmentList.items : null;
  const projects = projectList?.parent === departmentId ? projectList.items : null;

  const fail = (err: unknown, fallback: string) => setError(err instanceof ApiError ? err.message : fallback);

  useEffect(() => {
    apiClient
      .get<{ data: Option[] }>("/facilities")
      .then((res) => {
        setFacilities(res.data);
        if (res.data.length === 1) setFacilityId(res.data[0].id);
      })
      .catch((err) => fail(err, "Failed to load plants."));
  }, []);

  useEffect(() => {
    if (!facilityId) return;
    let cancelled = false;
    apiClient
      .get<{ data: Option[] }>(`/departments?facilityId=${encodeURIComponent(facilityId)}`)
      .then((res) => {
        if (cancelled) return;
        setDepartmentList({ parent: facilityId, items: res.data });
        if (res.data.length === 1) setDepartmentId(res.data[0].id);
      })
      .catch((err) => !cancelled && fail(err, "Failed to load projects."));
    return () => {
      cancelled = true;
    };
  }, [facilityId]);

  useEffect(() => {
    if (!departmentId) return;
    let cancelled = false;
    apiClient
      .get<{ data: Option[] }>(`/projects?departmentId=${encodeURIComponent(departmentId)}`)
      .then((res) => {
        if (cancelled) return;
        setProjectList({ parent: departmentId, items: res.data });
        if (res.data.length === 1) setProjectId(res.data[0].id);
      })
      .catch((err) => !cancelled && fail(err, "Failed to load parts."));
    return () => {
      cancelled = true;
    };
  }, [departmentId]);

  async function apply(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await apiClient.post("/context", { facilityId });
      if (departmentId) await apiClient.post("/context", { departmentId });
      if (projectId) await apiClient.post("/context", { projectId });
      await accessStore.refresh();
      const session = accessStore.getSnapshot().access?.session;
      onApplied?.();
      router.push(session ? workspaceDestination(session) : PROJECTS_PATH);
    } catch (err) {
      fail(err, "Unable to change workspace.");
    } finally {
      setBusy(false);
    }
  }

  const loading = facilities === null && !error;
  const noDepartments = Boolean(facilityId) && departments?.length === 0;
  const noProjects = Boolean(departmentId) && projects?.length === 0;

  return (
    <form onSubmit={apply} className="space-y-4" aria-label="Choose workspace">
      {error && <Alert>{error}</Alert>}
      {loading ? (
        <div className="space-y-3" role="status" aria-label="Loading workspaces">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : (
        <>
          <Field label="Plant" required>
            <Select
              value={facilityId}
              onChange={(e) => {
                setFacilityId(e.target.value);
                setDepartmentId("");
                setProjectId("");
              }}
            >
              <option value="">Select plant…</option>
              {facilities?.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </Select>
          </Field>

          {facilityId && (
            <Field
              label="Project"
              required
              hint={noDepartments ? "No projects are available for you in this plant." : undefined}
            >
              <Select
                value={departmentId}
                disabled={departments === null}
                onChange={(e) => {
                  setDepartmentId(e.target.value);
                  setProjectId("");
                }}
              >
                <option value="">{departments === null ? "Loading…" : "Select project…"}</option>
                {departments?.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </Select>
            </Field>
          )}

          {departmentId && (
            <Field
              label="Part"
              hint={noProjects ? "This project has no parts yet. Continue to create one." : undefined}
            >
              <Select value={projectId} disabled={projects === null} onChange={(e) => setProjectId(e.target.value)}>
                <option value="">{projects === null ? "Loading…" : "Select part…"}</option>
                {projects?.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </Select>
            </Field>
          )}
        </>
      )}
      <Button type="submit" disabled={busy || !facilityId || !departmentId} className="w-full">
        {busy ? "Opening…" : projectId ? submitLabel : "Continue to parts"}
      </Button>
    </form>
  );
}
