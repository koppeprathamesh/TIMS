"use client";

import { useCallback, useEffect, useState } from "react";
import { apiClient, ApiError } from "@/lib/apiClient";
import { usePermissions } from "@/lib/usePermissions";

interface Settings {
  organization: { id: string; name: string; code: string };
}

const controlClass =
  "rounded-[var(--radius-control)] border border-[var(--color-border)] px-3 py-2 text-sm";

export default function SettingsPage() {
  const permissions = usePermissions();
  const canManage = permissions?.has("settings.manage") ?? false;

  const [settings, setSettings] = useState<Settings | null>(null);
  const [orgName, setOrgName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    apiClient
      .get<{ data: Settings }>("/settings")
      .then((r) => {
        setSettings(r.data);
        setOrgName(r.data.organization.name);
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load settings."));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    setError(null);
    setMessage(null);
    try {
      await apiClient.patch("/settings", { name: orgName });
      setMessage("Organization updated.");
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Saving failed.");
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-2 py-6">
      <h1 className="page-heading mb-4 text-2xl font-semibold">Settings</h1>

      {error && <p role="alert" className="mb-3 text-sm text-[var(--color-danger)]">{error}</p>}
      {message && <p role="status" className="mb-3 text-sm text-[var(--color-success)]">{message}</p>}
      {!settings && !error && <p className="text-sm text-[var(--color-text-muted)]">Loading…</p>}

      {settings && (
        <form
          className="card space-y-3 p-4"
          aria-label="Organization settings"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <h2 className="text-lg font-semibold">Organization</h2>
          <p className="text-sm text-[var(--color-text-muted)]">Code: {settings.organization.code}</p>
          <div className="flex gap-3">
            <input required value={orgName} onChange={(e) => setOrgName(e.target.value)} aria-label="Organization name" disabled={!canManage} className={`${controlClass} w-80`} />
            {canManage && <button type="submit" className="btn-primary px-4 py-2 text-sm">Save</button>}
          </div>
          <p className="text-xs text-[var(--color-text-muted)]">
            Plants and projects are managed from the Plants page.
          </p>
        </form>
      )}
    </div>
  );
}
