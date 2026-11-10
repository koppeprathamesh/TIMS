"use client";

import { useEffect, useState } from "react";
import { apiClient, ApiError } from "@/lib/apiClient";

interface Machine {
  id: string;
  code: string;
  name: string;
  status: string;
}

export default function MachinesPage() {
  const [machines, setMachines] = useState<Machine[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .get<{ data: Machine[] }>("/machines")
      .then((res) => setMachines(res.data))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load machines."));
  }, []);

  return (
    <div className="mx-auto max-w-4xl px-2 py-6">
      <h1 className="page-heading mb-4 text-2xl font-semibold">Machines</h1>
      <div className="card p-4">
        {error && <p role="alert" className="text-sm text-[var(--color-danger)]">{error}</p>}
        {machines === null && !error && <p className="text-sm text-[var(--color-text-muted)]">Loading…</p>}
        {machines && machines.length === 0 && (
          <p className="text-sm text-[var(--color-text-muted)]">No machines configured for this plant.</p>
        )}
        {machines && machines.length > 0 && (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-xs uppercase text-[var(--color-text-muted)]">
                <th scope="col" className="py-2 pr-3">Code</th>
                <th scope="col" className="py-2 pr-3">Name</th>
                <th scope="col" className="py-2 pr-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {machines.map((m) => (
                <tr key={m.id} className="border-b border-[var(--color-border)]">
                  <td className="py-2 pr-3">{m.code}</td>
                  <td className="py-2 pr-3">{m.name}</td>
                  <td className="py-2 pr-3">{m.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
