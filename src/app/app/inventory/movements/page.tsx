"use client";

import { useCallback, useEffect, useState } from "react";
import { apiClient, ApiError } from "@/lib/apiClient";
import { useAccess } from "@/lib/usePermissions";
import { movementStatusLabel, movementTypeLabel, MOVEMENT_STATUS_LABELS, MOVEMENT_TYPE_LABELS } from "@/lib/labels";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Input, Select } from "@/components/ui/Input";
import { Pagination } from "@/components/ui/Pagination";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { Table, Td, Th } from "@/components/ui/Table";
import MovementForm from "@/components/forms/MovementForm";
import { Modal } from "@/components/ui/Modal";
import { Emoji } from "@/components/ui/Emoji";
import ScopeBar from "@/components/layout/ScopeBar";

interface MovementRow {
  id: string;
  movementNumber: string;
  movementType: string;
  status: string;
  reason: string | null;
  remarks: string | null;
  challanNumber: string | null;
  grnNumber: string | null;
  occurredAt: string;
  actor: { displayName: string };
  project: { name: string } | null;
  machine: { name: string } | null;
  vendor: { name: string } | null;
  transferFromProject: { name: string } | null;
  transferToProject: { name: string } | null;
  lines: { id: string; quantity: number; adjustmentDirection: string | null; tool: { code: string; name: string }; toolUnit: { serialNumber: string } | null }[];
}

interface ToolOption { id: string; code: string; name: string }

const REVERSIBLE = ["ISSUE", "RECEIPT", "RETURN", "TRANSFER"];
const STATUS_TONE: Record<string, BadgeTone> = {
  POSTED: "success",
  PENDING_APPROVAL: "warning",
  CANCELLED: "danger",
  REVERSED: "neutral",
};
const PAGE_SIZE = 20;

export default function MovementsPage() {
  const access = useAccess();
  const permissions = access?.permissions;
  const project = access?.session.project ?? null;
  const projectId = project?.id ?? null;
  const canApprove = permissions?.has("stock.adjust.approve") ?? false;
  const canReverse = permissions?.has("movement.reverse") ?? false;
  const canRecord = permissions?.has("movement.create") ?? false;

  const [movements, setMovements] = useState<MovementRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [toolFilter, setToolFilter] = useState("");
  const [toolOptions, setToolOptions] = useState<ToolOption[]>([]);
  const [recordOpen, setRecordOpen] = useState(false);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [reversing, setReversing] = useState<MovementRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .get<{ data: ToolOption[] }>("/tools?pageSize=100&sortBy=code")
      .then((res) => setToolOptions(res.data))
      .catch(() => {});
  }, []);

  const load = useCallback(() => {
    // Movements are always scoped to the selected project.
    if (!projectId) return;
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), projectId });
    if (typeFilter) params.set("movementType", typeFilter);
    if (statusFilter) params.set("status", statusFilter);
    if (toolFilter) params.set("toolId", toolFilter);
    apiClient
      .get<{ data: MovementRow[]; pagination: { total: number } }>(`/inventory/movements?${params}`)
      .then((res) => {
        setMovements(res.data);
        setTotal(res.pagination.total);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load movements."));
  }, [page, typeFilter, statusFilter, toolFilter, projectId]);

  useEffect(load, [load]);

  async function confirmReverse() {
    if (!reversing) return;
    setBusy(true);
    setActionMessage(null);
    setError(null);
    try {
      await apiClient.post(`/inventory/movements/${reversing.id}/reverse`);
      setActionMessage(`Movement ${reversing.movementNumber} reversed.`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to reverse this movement.");
    } finally {
      setBusy(false);
      setReversing(null);
    }
  }

  async function handleDecision(movementId: string, action: "approve" | "reject") {
    setActionMessage(null);
    setError(null);
    try {
      await apiClient.post(`/inventory/movements/${movementId}/${action}`, action === "reject" ? { reason: rejectReason } : undefined);
      setActionMessage(action === "approve" ? "Adjustment approved and posted." : "Adjustment rejected.");
      setRejectingId(null);
      setRejectReason("");
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to record the decision.");
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const showActions = canApprove || canReverse;
  const filtersActive = Boolean(typeFilter || statusFilter || toolFilter);

  function handleRecorded(message: string) {
    setActionMessage(message);
    setError(null);
    setRecordOpen(false);
    setPage(1);
    load();
  }

  return (
    <div className="mx-auto max-w-screen-2xl px-2 py-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <h1 className="page-heading text-3xl font-bold"><Emoji className="mr-2">🔄</Emoji>Movements</h1>
          <ScopeBar />
        </div>
        {canRecord && (
          <Button onClick={() => setRecordOpen(true)}><Emoji className="mr-1.5">📝</Emoji>Record Movement</Button>
        )}
      </div>

      {canRecord && (
        <Modal open={recordOpen} title="Record Movement" onClose={() => setRecordOpen(false)}>
          <MovementForm returnTo="/app/inventory/movements" onRecorded={handleRecorded} onCancel={() => setRecordOpen(false)} />
        </Modal>
      )}

      <h2 className="mb-2 text-lg font-semibold"><Emoji className="mr-1.5">🕘</Emoji>Movement History</h2>
      <div className="card p-4">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="w-56">
            <Select value={toolFilter} onChange={(e) => { setPage(1); setToolFilter(e.target.value); }} aria-label="Filter by tool">
              <option value="">All tools</option>
              {toolOptions.map((t) => (
                <option key={t.id} value={t.id}>{t.code} — {t.name}</option>
              ))}
            </Select>
          </div>
          <div className="w-48">
            <Select value={typeFilter} onChange={(e) => { setPage(1); setTypeFilter(e.target.value); }} aria-label="Filter by transaction type">
              <option value="">All types</option>
              {Object.entries(MOVEMENT_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </Select>
          </div>
          <div className="w-48">
            <Select value={statusFilter} onChange={(e) => { setPage(1); setStatusFilter(e.target.value); }} aria-label="Filter by status">
              <option value="">All statuses</option>
              {["POSTED", "PENDING_APPROVAL", "CANCELLED", "REVERSED"].map((value) => (
                <option key={value} value={value}>{MOVEMENT_STATUS_LABELS[value]}</option>
              ))}
            </Select>
          </div>
        </div>

        {error && <Alert className="mb-3">{error}</Alert>}
        {actionMessage && <Alert tone="success" className="mb-3">{actionMessage}</Alert>}

        {movements === null && !error && <TableSkeleton rows={6} columns={6} />}
        {movements && movements.length === 0 && (
          <div className="py-10 text-center">
            <h2 className="text-base font-semibold">{filtersActive ? "No movements match your filters" : "No movements yet"}</h2>
          </div>
        )}

        {movements && movements.length > 0 && (
          <Table caption="Inventory movements">
            <thead>
              <tr>
                <Th>Movement #</Th>
                <Th>Type</Th>
                <Th>Tool(s)</Th>
                <Th>Actor</Th>
                <Th>Machine</Th>
                <Th>Vendor</Th>
                <Th>Challan no.</Th>
                <Th>GRN no.</Th>
                <Th>Status</Th>
                <Th>Reason</Th>
                <Th>Note / Remark</Th>
                <Th>Date</Th>
                {showActions && <Th>Actions</Th>}
              </tr>
            </thead>
            <tbody>
              {movements.map((m) => (
                <tr key={m.id}>
                  <Td>{m.movementNumber}</Td>
                  <Td>
                    {movementTypeLabel(m.movementType)}
                    {m.transferFromProject && m.transferToProject && (
                      <span className="block text-xs text-[var(--color-text-muted)]">
                        {m.transferFromProject.name} → {m.transferToProject.name}
                      </span>
                    )}
                  </Td>
                  <Td>
                    {m.lines
                      .map((l) => `${l.toolUnit?.serialNumber ?? l.tool.code} (${l.adjustmentDirection === "DECREASE" ? "−" : ""}${l.quantity})`)
                      .join(", ")}
                  </Td>
                  <Td>{m.actor.displayName}</Td>
                  <Td>{m.machine?.name ?? "—"}</Td>
                  <Td>{m.vendor?.name ?? "—"}</Td>
                  <Td>{m.challanNumber ?? "—"}</Td>
                  <Td>{m.grnNumber ?? "—"}</Td>
                  <Td><Badge tone={STATUS_TONE[m.status] ?? "neutral"}>{movementStatusLabel(m.status)}</Badge></Td>
                  <Td>{m.reason ?? "—"}</Td>
                  <Td className="max-w-xs whitespace-pre-wrap break-words">{m.remarks ?? "—"}</Td>
                  <Td>{new Date(m.occurredAt).toLocaleString()}</Td>
                  {showActions && (
                    <Td>
                      {m.status === "PENDING_APPROVAL" && canApprove && (
                        <div className="flex flex-col gap-2">
                          <div className="flex gap-2">
                            <Button size="sm" onClick={() => handleDecision(m.id, "approve")}>✅ Approve</Button>
                            <Button size="sm" variant="danger" onClick={() => { setRejectingId(m.id); setRejectReason(""); }}>❌ Reject</Button>
                          </div>
                          {rejectingId === m.id && (
                            <div className="flex flex-wrap items-center gap-2">
                              <Input
                                value={rejectReason}
                                onChange={(e) => setRejectReason(e.target.value)}
                                placeholder="Reason for rejection"
                                aria-label="Reason for rejection"
                                className="w-48"
                              />
                              <Button size="sm" onClick={() => handleDecision(m.id, "reject")}>Confirm</Button>
                              <Button size="sm" variant="ghost" onClick={() => setRejectingId(null)}>Cancel</Button>
                            </div>
                          )}
                        </div>
                      )}
                      {m.status === "POSTED" && canReverse && REVERSIBLE.includes(m.movementType) && (
                        <Button size="sm" variant="danger" onClick={() => setReversing(m)}>↩️ Reverse</Button>
                      )}
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
        )}

        {movements && movements.length > 0 && (
          <Pagination page={page} totalPages={totalPages} total={total} noun="movement" onPageChange={setPage} />
        )}
      </div>

      <ConfirmDialog
        open={Boolean(reversing)}
        title="Reverse this movement?"
        confirmLabel="Reverse movement"
        destructive
        busy={busy}
        onCancel={() => setReversing(null)}
        onConfirm={confirmReverse}
      >
        {reversing && (
          <>
            This undoes the stock effect of {movementTypeLabel(reversing.movementType).toLowerCase()}{" "}
            <strong>{reversing.movementNumber}</strong> by posting an offsetting movement. The original stays in the
            history, marked Reversed. This cannot be undone.
          </>
        )}
      </ConfirmDialog>
    </div>
  );
}
