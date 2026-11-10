"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { apiClient, ApiError } from "@/lib/apiClient";
import { usePermissions } from "@/lib/usePermissions";
import { movementTypeLabel, movementStatusLabel, recordStatusLabel } from "@/lib/labels";
import { Alert } from "@/components/ui/Alert";
import { Button, LinkButton } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Emoji } from "@/components/ui/Emoji";
import { Skeleton, TableSkeleton } from "@/components/ui/Skeleton";
import { Table, Td, Th } from "@/components/ui/Table";

interface ToolDetail {
  id: string;
  code: string;
  name: string;
  drawingNumber: string | null;
  specNumber: string | null;
  minimumQuantity: number;
  totalStockCapacity: number;
  status: string;
  defaultLocation: { name: string } | null;
  availableQuantity: number;
  sharpeningQuantity: number;
  scrappedQuantity: number;
}

interface MovementLine {
  id: string;
  quantity: number;
  adjustmentDirection: string | null;
  createdAt: string;
  movement: { movementNumber: string; movementType: string; status: string; remarks: string | null; actor: { displayName: string } };
  sourceLocation: { name: string } | null;
  destinationLocation: { name: string } | null;
}

export default function ToolDetailPage() {
  return (
    <Suspense fallback={null}>
      <ToolDetailPageInner />
    </Suspense>
  );
}

function ToolDetailPageInner() {
  const params = useParams<{ toolId: string }>();
  const permissions = usePermissions();
  const canUpdate = permissions?.has("tool.update") ?? false;
  const canRecord = permissions?.has("movement.create") ?? false;
  const canDelete = permissions?.has("tool.delete") ?? false;
  const router = useRouter();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [tool, setTool] = useState<ToolDetail | null>(null);
  const [movements, setMovements] = useState<MovementLine[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await apiClient.delete(`/tools/${params.toolId}`);
      router.push("/app/dashboard");
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : "Unable to delete the tool.");
      setConfirmingDelete(false);
      setDeleteBusy(false);
    }
  }

  useEffect(() => {
    apiClient
      .get<{ data: ToolDetail }>(`/tools/${params.toolId}`)
      .then((res) => setTool(res.data))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load tool."));
    apiClient
      .get<{ data: MovementLine[] }>(`/tools/${params.toolId}/movements`)
      .then((res) => setMovements(res.data))
      .catch(() => setMovements([]));
  }, [params.toolId]);

  if (error) {
    return (
      <div className="mx-auto max-w-4xl space-y-3 px-2 py-6">
        <Alert>{error}</Alert>
        <Link href="/app/dashboard">Back to dashboard</Link>
      </div>
    );
  }
  if (!tool) {
    return (
      <div className="mx-auto max-w-4xl space-y-4 px-2 py-6" role="status" aria-label="Loading tool">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-2 py-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-2">
          <h1 className="page-heading break-words text-3xl font-bold">{tool.name}</h1>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-primary-soft)] px-3 py-1 text-base font-semibold text-[var(--color-primary)]">
            <Emoji>🔧</Emoji>{tool.code}
          </span>
        </div>
        <div className="flex gap-2">
          {canUpdate && <LinkButton href={`/app/tools/${tool.id}/edit`} variant="secondary">✏️ Edit</LinkButton>}
          {canRecord && <LinkButton href={`/app/tools/${tool.id}/movements/new`}>⚙️ Manage</LinkButton>}
          {canDelete && <Button variant="danger" onClick={() => setConfirmingDelete(true)}>🗑️ Delete</Button>}
        </div>
      </div>

      {deleteError && <Alert className="mb-4">{deleteError}</Alert>}

      <ConfirmDialog
        open={confirmingDelete}
        title="Delete this tool?"
        confirmLabel="Delete tool"
        destructive
        busy={deleteBusy}
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={handleDelete}
      >
        Delete <strong>{tool.name}</strong> ({tool.code})? This cannot be undone. Tools that already have movement
        history cannot be deleted; set them to Inactive instead.
      </ConfirmDialog>

      <div className="card grid grid-cols-2 gap-4 p-6 sm:grid-cols-3">
        <Info label="Available" value={tool.availableQuantity} />
        <Info label="Minimum Qty" value={tool.minimumQuantity} />
        <Info label="Stock Capacity" value={tool.totalStockCapacity} />
        <Info label="In Sharpening" value={tool.sharpeningQuantity} />
        <Info label="Scrapped" value={tool.scrappedQuantity} />
        <Info label="Status" value={recordStatusLabel(tool.status)} />
        <Info label="Drawing No." value={tool.drawingNumber ?? "—"} />
        <Info label="Spec No." value={tool.specNumber ?? "—"} />
        <Info label="Location" value={tool.defaultLocation?.name ?? "—"} />
      </div>

      <h2 className="mb-2 mt-6 text-lg font-semibold">Recent Movements</h2>
      <div className="card p-4">
        {movements === null && <TableSkeleton rows={3} columns={5} />}
        {movements && movements.length === 0 && (
          <p className="text-sm text-[var(--color-text-muted)]">No movements recorded yet.</p>
        )}
        {movements && movements.length > 0 && (
          <Table caption="Recent movements for this tool">
            <thead>
              <tr>
                <Th>Movement #</Th>
                <Th>Type</Th>
                <Th>Qty</Th>
                <Th>From</Th>
                <Th>To</Th>
                <Th>By</Th>
                <Th>Status</Th>
                <Th>Note / Remark</Th>
                <Th>Date</Th>
              </tr>
            </thead>
            <tbody>
              {movements.map((line) => (
                <tr key={line.id}>
                  <Td>{line.movement.movementNumber}</Td>
                  <Td>{movementTypeLabel(line.movement.movementType)}</Td>
                  <Td>{line.adjustmentDirection === "DECREASE" ? "−" : ""}{line.quantity}</Td>
                  <Td>{line.sourceLocation?.name ?? "—"}</Td>
                  <Td>{line.destinationLocation?.name ?? "—"}</Td>
                  <Td>{line.movement.actor.displayName}</Td>
                  <Td>{movementStatusLabel(line.movement.status)}</Td>
                  <Td className="max-w-xs whitespace-pre-wrap break-words">{line.movement.remarks ?? "—"}</Td>
                  <Td>{new Date(line.createdAt).toLocaleString()}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className="text-xs text-[var(--color-text-muted)]">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}
