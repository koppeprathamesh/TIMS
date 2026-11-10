"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiClient, ApiError } from "@/lib/apiClient";
import { movementStatusLabel, movementTypeLabel } from "@/lib/labels";
import MovementForm from "@/components/forms/MovementForm";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Skeleton, TableSkeleton } from "@/components/ui/Skeleton";
import { Table, Td, Th } from "@/components/ui/Table";
import { Emoji } from "@/components/ui/Emoji";
import ScopeBar from "@/components/layout/ScopeBar";

interface ToolDetail {
  id: string;
  code: string;
  name: string;
  availableQuantity: number;
  sharpeningQuantity: number;
  scrappedQuantity: number;
  minimumQuantity: number;
}

interface MovementLine {
  id: string;
  quantity: number;
  adjustmentDirection: string | null;
  createdAt: string;
  movement: {
    movementNumber: string;
    movementType: string;
    status: string;
    challanNumber: string | null;
    grnNumber: string | null;
    remarks: string | null;
    machine: { name: string } | null;
    vendor: { name: string } | null;
    transferFromProject: { name: string } | null;
    transferToProject: { name: string } | null;
    actor: { displayName: string };
  };
  sourceLocation: { name: string } | null;
  destinationLocation: { name: string } | null;
  toolUnit: { serialNumber: string } | null;
}

export default function NewToolMovementPage() {
  return (
    <Suspense fallback={null}>
      <NewToolMovement />
    </Suspense>
  );
}

function NewToolMovement() {
  const { toolId } = useParams<{ toolId: string }>();
  const [tool, setTool] = useState<ToolDetail | null>(null);
  const [history, setHistory] = useState<MovementLine[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [recordOpen, setRecordOpen] = useState(false);

  const load = useCallback(() => {
    apiClient
      .get<{ data: ToolDetail }>(`/tools/${toolId}`)
      .then((res) => setTool(res.data))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load tool."));
    apiClient
      .get<{ data: MovementLine[] }>(`/tools/${toolId}/movements`)
      .then((res) => setHistory(res.data))
      .catch(() => setHistory([]));
  }, [toolId]);

  useEffect(load, [load]);

  function handleRecorded(text: string) {
    setMessage(text);
    setRecordOpen(false);
    load();
  }

  return (
    <div className="mx-auto max-w-6xl px-2 py-6">
      <Link href="/app/dashboard" className="mb-4 inline-block text-sm">← Back to dashboard</Link>
      <div className="card mb-4 space-y-3 border-l-4 border-l-[var(--color-primary)] p-5">
        <p className="text-sm font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
          <Emoji className="mr-1">⚙️</Emoji>Manage tool
        </p>
        {tool ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <h1 className="page-heading break-words text-3xl font-bold">
              <Link href={`/app/tools/${tool.id}`} className="text-[var(--color-text)]">{tool.name}</Link>
            </h1>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-primary-soft)] px-3 py-1 text-base font-semibold text-[var(--color-primary)]">
              <Emoji>🔧</Emoji>{tool.code}
            </span>
          </div>
        ) : (
          <h1 className="page-heading text-3xl font-bold">Manage Tool</h1>
        )}
        <ScopeBar />
      </div>
      {error && <Alert className="mb-4">{error}</Alert>}
      {message && <Alert tone="success" className="mb-4">{message}</Alert>}

      {!tool && !error && <Skeleton className="mb-4 h-20" />}
      {tool && (
        <div className="card mb-4 grid grid-cols-2 gap-4 p-4 sm:grid-cols-4" aria-label="Current stock">
          <Stat icon="✅" label="Available stock" value={tool.availableQuantity} color="var(--color-success)" />
          <Stat icon="📉" label="Minimum qty" value={tool.minimumQuantity} color="var(--color-warning)" />
          <Stat icon="🔧" label="In sharpening" value={tool.sharpeningQuantity} color="var(--color-processing)" />
          <Stat icon="🗑️" label="Scrapped" value={tool.scrappedQuantity} color="var(--color-neutral)" />
        </div>
      )}

      <div className="mb-2 mt-6 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold"><Emoji className="mr-1.5">🕘</Emoji>Movement History</h2>
        <Button onClick={() => setRecordOpen(true)}><Emoji className="mr-1.5">📝</Emoji>Record Movement</Button>
      </div>
      <Modal open={recordOpen} title="Record Movement" onClose={() => setRecordOpen(false)}>
        <MovementForm initialToolId={toolId} lockTool returnTo="/app/dashboard" onRecorded={handleRecorded} onCancel={() => setRecordOpen(false)} />
      </Modal>
      <div className="card p-4">
        {history === null && <TableSkeleton rows={3} columns={6} />}
        {history && history.length === 0 && (
          <p className="text-sm text-[var(--color-text-muted)]">No transactions recorded for this tool yet.</p>
        )}
        {history && history.length > 0 && (
          <Table caption="Transaction history for this tool">
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Movement #</Th>
                <Th>Type</Th>
                <Th>Tool ID</Th>
                <Th>Qty</Th>
                <Th>From</Th>
                <Th>To</Th>
                <Th>Machine</Th>
                <Th>Vendor</Th>
                <Th>Challan no.</Th>
                <Th>GRN no.</Th>
                <Th>By</Th>
                <Th>Status</Th>
                <Th>Note / Remark</Th>
              </tr>
            </thead>
            <tbody>
              {history.map((line) => (
                <tr key={line.id}>
                  <Td>{new Date(line.createdAt).toLocaleString()}</Td>
                  <Td>{line.movement.movementNumber}</Td>
                  <Td>
                    {movementTypeLabel(line.movement.movementType)}
                    {line.movement.transferFromProject && line.movement.transferToProject && (
                      <span className="block text-xs text-[var(--color-text-muted)]">
                        {line.movement.transferFromProject.name} → {line.movement.transferToProject.name}
                      </span>
                    )}
                  </Td>
                  <Td>{line.toolUnit?.serialNumber ?? "—"}</Td>
                  <Td>{line.movement.movementType === "TRANSFER" && !line.toolUnit ? "—" : `${line.adjustmentDirection === "DECREASE" ? "−" : ""}${line.quantity}`}</Td>
                  <Td>{line.sourceLocation?.name ?? "—"}</Td>
                  <Td>{line.destinationLocation?.name ?? "—"}</Td>
                  <Td>{line.movement.machine?.name ?? "—"}</Td>
                  <Td>{line.movement.vendor?.name ?? "—"}</Td>
                  <Td>{line.movement.challanNumber ?? "—"}</Td>
                  <Td>{line.movement.grnNumber ?? "—"}</Td>
                  <Td>{line.movement.actor.displayName}</Td>
                  <Td>{movementStatusLabel(line.movement.status)}</Td>
                  <Td className="max-w-xs whitespace-pre-wrap break-words">{line.movement.remarks ?? "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
    </div>
  );
}

function Stat({ icon, label, value, color }: { icon: string; label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden="true"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg"
        style={{ backgroundColor: `color-mix(in srgb, ${color} 12%, white)` }}
      >
        {icon}
      </span>
      <div>
        <p className="text-xs text-[var(--color-text-muted)]">{label}</p>
        <p className="text-xl font-semibold" style={{ color }}>{value}</p>
      </div>
    </div>
  );
}
