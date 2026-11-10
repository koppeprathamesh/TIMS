"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiClient, ApiError } from "@/lib/apiClient";
import { useAccess } from "@/lib/usePermissions";
import { movementTypeLabel } from "@/lib/labels";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Field, Input, Select, Textarea } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/Skeleton";
import { QuickAdd } from "@/components/forms/QuickAdd";

type MovementType =
  | "RECEIPT" | "ISSUE" | "RETURN" | "TRANSFER" | "ADJUSTMENT" | "SCRAP" | "SHARPEN_DISPATCH" | "SHARPEN_RETURN";
type Direction = "INCREASE" | "DECREASE";

const TYPE_OPTIONS: { value: MovementType; label: string }[] = [
  { value: "RECEIPT", label: "📥 Receive" },
  { value: "ISSUE", label: "📤 Issue" },
  { value: "RETURN", label: "↩️ Return" },
  { value: "TRANSFER", label: "🔀 Transfer" },
  { value: "ADJUSTMENT", label: "✏️ Adjustment" },
  { value: "SCRAP", label: "🗑️ Scrap / damage" },
  { value: "SHARPEN_DISPATCH", label: "🔧 Sharpening dispatch" },
  { value: "SHARPEN_RETURN", label: "✅ Sharpening return" },
];

const SHARPENING_TYPES: MovementType[] = ["SHARPEN_DISPATCH", "SHARPEN_RETURN"];
// These pick individual tool items by their unique ID (e.g. TOO5155-3), several at a time.
// Receipts create new items, so there is nothing to pick; an adjustment only picks when decreasing.
// None of them asks for a storage location: it is the tool's own (set when the tool was created).
const UNIT_TYPES: MovementType[] = ["ISSUE", "RETURN", "TRANSFER", "SCRAP", "SHARPEN_DISPATCH", "SHARPEN_RETURN"];
const MAX_LINES = 100;

interface ToolOption { id: string; code: string; name: string; location: string | null; locationId: string | null }
interface Machine { id: string; name: string }
interface Vendor { id: string; name: string }
interface TransferTarget { id: string; name: string }
interface UnitOption {
  id: string;
  serialNumber: string;
  toolId: string;
  toolCode: string;
  toolName: string;
  /** Where the item is now, or for an issued item the location it returns to. */
  locationName: string | null;
}
interface Balance { toolId: string; stockStatus: string; onHandQuantity: number; location: { id: string } }

interface Line {
  key: number;
  toolId: string;
  toolUnitIds: string[];
  quantity: string;
  direction: Direction;
}

type LineErrors = Partial<Record<"tool" | "quantity", string>>;

let lineKey = 0;
const newLine = (toolId = ""): Line => ({
  key: ++lineKey,
  toolId,
  toolUnitIds: [],
  quantity: "",
  direction: "INCREASE",
});

// A checkbox list of tool IDs: tick any number of them for one movement. Each row shows the
// (read-only) storage location of that item.
function UnitChecklist({
  units,
  selected,
  onChange,
  placeholder,
  locationLabel,
  error,
  hint,
}: {
  units: UnitOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
  locationLabel: string;
  error?: string | null;
  hint?: string;
}) {
  const allSelected = units.length > 0 && units.every((u) => selected.includes(u.id));
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);

  return (
    <fieldset className="flex flex-col gap-1 sm:col-span-2" aria-invalid={Boolean(error) || undefined}>
      <legend className="mb-1 flex w-full items-center justify-between gap-2 text-sm font-medium">
        <span>
          Tool IDs <span aria-hidden="true" className="text-[var(--color-danger)]">*</span>
          {selected.length > 0 && (
            <span className="ml-2 text-xs font-normal text-[var(--color-text-muted)]">{selected.length} selected</span>
          )}
        </span>
        {units.length > 1 && (
          <button
            type="button"
            className="text-xs font-normal text-[var(--color-primary)] underline"
            onClick={() => onChange(allSelected ? [] : units.map((u) => u.id))}
          >
            {allSelected ? "Clear all" : "Select all"}
          </button>
        )}
      </legend>
      {units.length === 0 ? (
        <p className="rounded-[var(--radius-control)] border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-text-muted)]">
          {placeholder}
        </p>
      ) : (
        <ul
          className={`max-h-48 divide-y divide-[var(--color-border)] overflow-y-auto rounded-[var(--radius-control)] border bg-white ${
            error ? "border-[var(--color-danger)]" : "border-[var(--color-border)]"
          }`}
        >
          {units.map((u) => (
            <li key={u.id}>
              <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-[var(--color-surface)]">
                <input type="checkbox" checked={selected.includes(u.id)} onChange={() => toggle(u.id)} />
                <span className="font-medium">{u.serialNumber}</span>
                <span className="text-[var(--color-text-muted)]">— {u.toolName}</span>
                {u.locationName && (
                  <span className="ml-auto text-xs text-[var(--color-text-muted)]">📍 {locationLabel} {u.locationName}</span>
                )}
              </label>
            </li>
          ))}
        </ul>
      )}
      {hint && <p className="text-xs text-[var(--color-text-muted)]">{hint}</p>}
      {error && (
        <p role="alert" className="text-xs text-[var(--color-danger)]">
          {error}
        </p>
      )}
    </fieldset>
  );
}


export default function MovementForm({
  initialToolId,
  returnTo,
  onRecorded,
  onCancel,
  onToolChange,
  lockTool,
}: {
  initialToolId?: string;
  returnTo: string;
  /** The page is already about one tool: hide the tool picker and its stock line. */
  lockTool?: boolean;
  /** When given, the form stays on the page after recording and hands the confirmation to the caller. */
  onRecorded?: (message: string) => void;
  /** When given, Cancel calls this instead of navigating to `returnTo`. */
  onCancel?: () => void;
  /** Reports the tool chosen on the first line, so the page can show that tool's history. */
  onToolChange?: (toolId: string) => void;
}) {
  const router = useRouter();
  const access = useAccess();
  const projectId = access?.session.project?.id ?? null;

  const [movementType, setMovementType] = useState<MovementType>("ISSUE");
  const [lines, setLines] = useState<Line[]>(() => [newLine(initialToolId)]);
  const [machineId, setMachineId] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [grnNumber, setGrnNumber] = useState("");
  const [transferToProjectId, setTransferToProjectId] = useState("");
  const [reason, setReason] = useState("");
  const [remarks, setRemarks] = useState("");
  const [challanNumber, setChallanNumber] = useState("");

  const [tools, setTools] = useState<ToolOption[] | null>(null);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [targetsByTool, setTargetsByTool] = useState<Record<string, TransferTarget[]>>({});
  const requestedTargets = useRef(new Set<string>());
  const [balances, setBalances] = useState<Balance[]>([]);
  const [unitsByKey, setUnitsByKey] = useState<Record<string, UnitOption[]>>({});
  const requestedUnits = useRef(new Set<string>());
  const [loadError, setLoadError] = useState<string | null>(null);

  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const firstToolId = lines[0]?.toolId ?? "";
  useEffect(() => {
    onToolChange?.(firstToolId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstToolId]);

  const unitById = useMemo(() => {
    const map = new Map<string, UnitOption>();
    for (const list of Object.values(unitsByKey)) for (const u of list) map.set(u.id, u);
    return map;
  }, [unitsByKey]);

  // A transfer can only go to the other parts of the selected tools' own project, so the choices are
  // the parts every selected tool can move to. Targets are cached per tool.
  const transferToolIds = useMemo(() => {
    if (movementType !== "TRANSFER") return [];
    const ids = new Set<string>();
    for (const line of lines) for (const id of line.toolUnitIds) {
      const toolId = unitById.get(id)?.toolId;
      if (toolId) ids.add(toolId);
    }
    return [...ids].sort();
  }, [movementType, lines, unitById]);

  useEffect(() => {
    for (const toolId of transferToolIds) {
      if (requestedTargets.current.has(toolId)) continue;
      requestedTargets.current.add(toolId);
      apiClient
        .get<{ data: TransferTarget[] }>(`/tools/${toolId}/transfer-targets`)
        .then((r) => setTargetsByTool((prev) => ({ ...prev, [toolId]: r.data })))
        .catch(() => setTargetsByTool((prev) => ({ ...prev, [toolId]: [] })));
    }
  }, [transferToolIds]);

  const transferTargets = useMemo(() => {
    if (!transferToolIds.length || transferToolIds.some((id) => !targetsByTool[id])) return null;
    const [first, ...rest] = transferToolIds.map((id) => targetsByTool[id]);
    return first.filter((t) => rest.every((list) => list.some((o) => o.id === t.id)));
  }, [transferToolIds, targetsByTool]);
  const selectedTransferId = transferTargets?.some((t) => t.id === transferToProjectId) ? transferToProjectId : "";

  useEffect(() => {
    const fail = (err: unknown) => setLoadError(err instanceof ApiError ? err.message : "Unable to load form data.");
    apiClient.get<{ data: ToolOption[] }>("/tools?status=ACTIVE&pageSize=100&sortBy=code").then((r) => setTools(r.data)).catch(fail);
    apiClient.get<{ data: Balance[] }>("/inventory/balances").then((r) => setBalances(r.data)).catch(() => {});
    apiClient.get<{ data: Machine[] }>("/machines").then((r) => setMachines(r.data)).catch(() => {});
    apiClient.get<{ data: Vendor[] }>("/vendors").then((r) => setVendors(r.data)).catch(() => {});
  }, []);

  // Whole-facility stock for a tool, so the user sees what exists before recording the movement.
  const stockSummary = (toolId: string) => {
    const sum = (status: string) =>
      balances.filter((b) => b.toolId === toolId && b.stockStatus === status).reduce((total, b) => total + b.onHandQuantity, 0);
    return `Stock — Available: ${sum("AVAILABLE")} · In sharpening: ${sum("SHARPENING")} · Scrapped: ${sum("SCRAPPED")}`;
  };

  async function addMachine(name: string) {
    const res = await apiClient.post<{ data: Machine }>("/machines", { name });
    setMachines((prev) => [...prev, res.data].sort((a, b) => a.name.localeCompare(b.name)));
    setMachineId(res.data.id);
  }

  async function addVendor(name: string) {
    const res = await apiClient.post<{ data: Vendor }>("/vendors", { name });
    setVendors((prev) => [...prev, res.data].sort((a, b) => a.name.localeCompare(b.name)));
    setVendorId(res.data.id);
  }

  const isAdjustment = movementType === "ADJUSTMENT";
  const isTransfer = movementType === "TRANSFER";
  const isSharpening = SHARPENING_TYPES.includes(movementType);
  const needsGrn = movementType === "RECEIPT";
  const showMachine = movementType !== "RECEIPT" && !isSharpening && !isTransfer;
  const usesUnits = UNIT_TYPES.includes(movementType);
  const lockedToolId = lockTool ? initialToolId : undefined;
  // Which items a line picks from: returns come from items issued out, sharpening returns from items
  // at the vendor, everything else from items on the shelf.
  const unitStatus = movementType === "SHARPEN_RETURN" ? "SHARPENING" : movementType === "RETURN" ? "ISSUED" : "AVAILABLE";
  const lineUsesUnits = (line: Line) => usesUnits || (isAdjustment && line.direction === "DECREASE");
  const unitList = unitsByKey[unitStatus];
  const toolById = (id: string) => tools?.find((t) => t.id === id);
  // Changing the movement type or direction invalidates picked tool IDs (and the tool they implied,
  // unless the page fixes it).
  const clearUnits = { toolUnitIds: [] as string[], ...(lockTool ? {} : { toolId: "" }) };

  const needsUnitList = lines.some(lineUsesUnits);
  useEffect(() => {
    if (!needsUnitList || requestedUnits.current.has(unitStatus)) return;
    requestedUnits.current.add(unitStatus);
    const params = new URLSearchParams({ status: unitStatus });
    if (lockedToolId) params.set("toolId", lockedToolId);
    apiClient
      .get<{ data: UnitOption[] }>(`/tool-units?${params}`)
      .then((r) => setUnitsByKey((prev) => ({ ...prev, [unitStatus]: r.data })))
      .catch(() => {
        requestedUnits.current.delete(unitStatus);
        setUnitsByKey((prev) => ({ ...prev, [unitStatus]: [] }));
      });
  }, [needsUnitList, unitStatus, lockedToolId]);

  const errors = useMemo(() => {
    const perLine = new Map<number, LineErrors>();
    for (const line of lines) {
      const e: LineErrors = {};
      if (lineUsesUnits(line)) {
        if (!line.toolUnitIds.length) e.tool = "Select at least one tool ID.";
        perLine.set(line.key, e);
        continue;
      }
      if (!line.toolId) e.tool = "Choose a tool.";
      else if (toolById(line.toolId) && !toolById(line.toolId)?.locationId) e.tool = "This tool has no storage location. Set one on the tool first.";
      const qty = Number(line.quantity);
      if (line.quantity.trim() === "") e.quantity = "Enter a quantity.";
      else if (!Number.isInteger(qty) || qty <= 0) e.quantity = "Quantity must be a whole number greater than zero.";
      perLine.set(line.key, e);
    }
    const reasonError = isAdjustment && !reason.trim() ? "A reason is required for adjustments." : null;
    const grnError = !needsGrn
      ? null
      : !grnNumber.trim()
        ? "Enter the GRN No."
        : !/^[A-Za-z0-9]+$/.test(grnNumber.trim())
          ? "GRN No. may contain only letters and digits."
          : null;
    const transferError = isTransfer && !selectedTransferId ? "Choose the part to transfer the tool to." : null;
    const submittedLines = lines.reduce((total, l) => total + (lineUsesUnits(l) ? l.toolUnitIds.length : 1), 0);
    const limitError = submittedLines > MAX_LINES ? `Select at most ${MAX_LINES} tools per movement.` : null;
    const valid =
      lines.length > 0 &&
      [...perLine.values()].every((e) => Object.keys(e).length === 0) &&
      !reasonError &&
      !grnError &&
      !transferError &&
      !limitError;
    return { perLine, reasonError, grnError, transferError, limitError, valid };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, movementType, reason, tools, grnNumber, selectedTransferId]);

  const patchLine = (key: number, patch: Partial<Line>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitted(true);
    if (!errors.valid) return;

    setSubmitting(true);
    try {
      const res = await apiClient.post<{ data: { movementNumber: string; status: string } }>("/inventory/movements", {
        movementType,
        lines: lines.flatMap((l) => {
          const direction = isAdjustment ? { adjustmentDirection: l.direction } : {};
          if (!lineUsesUnits(l)) return [{ toolId: l.toolId, quantity: Number(l.quantity), ...direction }];
          // One movement line per picked tool ID, all recorded in a single transaction. The storage
          // location is worked out by the server from the tool / the item's current location.
          return l.toolUnitIds.map((id) => ({
            toolId: unitById.get(id)?.toolId ?? l.toolId,
            toolUnitId: id,
            quantity: 1,
            ...direction,
          }));
        }),
        ...(showMachine ? { machineId: machineId || null } : {}),
        ...(isSharpening ? { vendorId: vendorId || null } : {}),
        ...(needsGrn ? { grnNumber: grnNumber.trim() } : {}),
        ...(isTransfer ? { transferToProjectId: selectedTransferId } : {}),
        projectId,
        reason: reason.trim() || null,
        remarks: remarks.trim() || null,
        ...(isSharpening ? { challanNumber: challanNumber.trim() || null } : {}),
        idempotencyKey,
      });
      const message =
        res.data.status === "PENDING_APPROVAL"
          ? `Adjustment ${res.data.movementNumber} was submitted for approval. Stock changes once a Super Admin approves it.`
          : `Movement ${res.data.movementNumber} recorded.`;
      if (onRecorded) {
        // The tool IDs just moved no longer match what was listed; start the next entry afresh.
        requestedUnits.current.clear();
        setUnitsByKey({});
        setLines((prev) => prev.map((l) => (lineUsesUnits(l) ? { ...l, ...clearUnits } : l)));
        setSubmitting(false);
        onRecorded(message);
        return;
      }
      setSuccess(message);
      setTimeout(() => router.push(returnTo), 1200);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to record the movement.");
      setSubmitting(false);
    }
  }

  const show = (message?: string | null) => (submitted ? message ?? null : null);

  if (loadError) return <Alert>{loadError}</Alert>;
  if (!tools) {
    return (
      <div className="card space-y-3 p-6" role="status" aria-label="Loading form">
        <Skeleton className="h-10" />
        <Skeleton className="h-24" />
        <Skeleton className="h-10" />
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="card flex flex-col gap-5 p-6" noValidate>
      {error && <Alert>{error}</Alert>}
      {success && <Alert tone="success">{success}</Alert>}

      <Field label="Transaction type" required>
        <Select
          value={movementType}
          onChange={(e) => {
            const next = e.target.value as MovementType;
            setMovementType(next);
            // Picked tool IDs belong to the old type's status, so they start empty again. Types that
            // pick tool IDs use a single list, so extra lines are dropped.
            setLines((prev) =>
              (UNIT_TYPES.includes(next) ? prev.slice(0, 1) : prev).map((l) => ({
                ...l,
                toolUnitIds: [],
                toolId: lockTool ? l.toolId : lineUsesUnits(l) ? "" : l.toolId,
              }))
            );
          }}
        >
          {TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </Select>
      </Field>

      <fieldset className="space-y-3">
        <legend className="mb-1 text-sm font-semibold">{movementTypeLabel(movementType)} — tools</legend>
        {lines.map((line, index) => {
          const e = errors.perLine.get(line.key) ?? {};
          return (
            <div key={line.key} className="space-y-3 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase text-[var(--color-text-muted)]">Line {index + 1}</span>
                {lines.length > 1 && (
                  <Button size="sm" variant="ghost" onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}>
                    Remove
                  </Button>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {!lockTool && !lineUsesUnits(line) && (
                  <Field label="Tool" required error={show(e.tool)} hint={line.toolId ? stockSummary(line.toolId) : undefined}>
                    <Select value={line.toolId} onChange={(ev) => patchLine(line.key, { toolId: ev.target.value })}>
                      <option value="">Select a tool…</option>
                      {tools.map((t) => (
                        <option key={t.id} value={t.id}>{t.code} — {t.name}</option>
                      ))}
                    </Select>
                  </Field>
                )}
                {!lineUsesUnits(line) && (
                  <Field label="Quantity" required error={show(e.quantity)}>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      step={1}
                      value={line.quantity}
                      onChange={(ev) => patchLine(line.key, { quantity: ev.target.value })}
                    />
                  </Field>
                )}
                {!lineUsesUnits(line) && toolById(line.toolId) && (
                  <Field label="Storage location" hint="Taken from the tool; change it by editing the tool.">
                    <Input readOnly value={toolById(line.toolId)?.location ?? "—"} />
                  </Field>
                )}
                {isAdjustment && (
                  <Field label="Adjustment direction" required>
                    <Select
                      value={line.direction}
                      onChange={(ev) =>
                        patchLine(line.key, { direction: ev.target.value as Direction, ...clearUnits })
                      }
                    >
                      <option value="INCREASE">Increase stock</option>
                      <option value="DECREASE">Decrease stock</option>
                    </Select>
                  </Field>
                )}
                {lineUsesUnits(line) && (() => {
                  const options = (unitList ?? []).filter(
                    (u) => line.toolUnitIds.includes(u.id) || !lines.some((o) => o.key !== line.key && o.toolUnitIds.includes(u.id))
                  );
                  const placeholder = !unitList
                    ? "Loading tool IDs…"
                    : unitStatus === "ISSUED"
                      ? "No issued tools to return."
                      : `No tools ${unitStatus === "SHARPENING" ? "in sharpening" : "available"}.`;
                  return (
                    <UnitChecklist
                      units={options}
                      selected={line.toolUnitIds}
                      placeholder={placeholder}
                      locationLabel={unitStatus === "ISSUED" ? "returns to" : "at"}
                      error={show(e.tool)}
                      onChange={(ids) =>
                        patchLine(line.key, {
                          toolUnitIds: ids,
                          toolId: unitById.get(ids[0])?.toolId ?? (lockTool ? line.toolId : ""),
                        })
                      }
                    />
                  );
                })()}
              </div>
            </div>
          );
        })}
        {errors.limitError && submitted && <p role="alert" className="text-xs text-[var(--color-danger)]">{errors.limitError}</p>}
        {!lockTool && !usesUnits && (
          <Button variant="secondary" size="sm" onClick={() => setLines((prev) => [...prev, newLine()])}>
            ➕ Add another tool
          </Button>
        )}
      </fieldset>

      {isTransfer && (
        <Field
          label="Transfer to Part"
          required
          error={show(errors.transferError)}
          hint={
            transferToolIds.length && transferTargets && transferTargets.length === 0
              ? "No other part is available to every selected tool."
              : "Only parts within the selected tools' current project are listed."
          }
        >
          <Select
            value={selectedTransferId}
            onChange={(e) => setTransferToProjectId(e.target.value)}
            disabled={!transferToolIds.length || transferTargets === null}
          >
            <option value="">{!transferToolIds.length ? "Select tool IDs first…" : transferTargets === null ? "Loading…" : "Select a part…"}</option>
            {(transferTargets ?? []).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Select>
        </Field>
      )}

      {showMachine && (
        <div className="flex flex-col gap-1">
          <Field label="🛠️ Machine (optional)">
            <Select value={machineId} onChange={(e) => setMachineId(e.target.value)}>
              <option value="">None</option>
              {machines.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </Select>
          </Field>
          <QuickAdd label="Add new machine" placeholder="New machine name" onAdd={addMachine} />
        </div>
      )}

      {isSharpening && (
        <div className="flex flex-col gap-1">
          <Field label="🏭 Vendor">
            <Select value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
              <option value="">None</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </Select>
          </Field>
          <QuickAdd label="Add Vendor" placeholder="New vendor name" onAdd={addVendor} />
        </div>
      )}

      {needsGrn && (
        <Field label="📦 GRN No." required error={show(errors.grnError)}>
          <Input value={grnNumber} onChange={(e) => setGrnNumber(e.target.value)} maxLength={50} autoComplete="off" />
        </Field>
      )}

      {isSharpening && (
        <Field label="🧾 Challan no.">
          <Input value={challanNumber} onChange={(e) => setChallanNumber(e.target.value)} maxLength={50} />
        </Field>
      )}

      {isAdjustment && (
        <Field label="Reason" required error={show(errors.reasonError)}>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </Field>
      )}

      <Field label="Remarks / notes">
        <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={3} maxLength={2000} />
      </Field>

      <div className="flex gap-3">
        <Button type="submit" disabled={submitting || Boolean(success)}>
          {submitting ? "Submitting…" : "✔️ Submit movement"}
        </Button>
        <Button variant="secondary" onClick={() => (onCancel ? onCancel() : router.push(returnTo))}>Cancel</Button>
      </div>
    </form>
  );
}
