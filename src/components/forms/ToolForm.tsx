"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiClient, ApiError } from "@/lib/apiClient";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Field, Input, Select } from "@/components/ui/Input";
import { QuickAdd } from "@/components/forms/QuickAdd";

interface StorageLocation {
  id: string;
  name: string;
  code: string;
}

// Numbers are kept as strings while editing so a blank field is reported, not silently read as 0.
export interface ToolFormValues {
  code: string;
  name: string;
  drawingNumber: string;
  specNumber: string;
  minimumQuantity: number;
  totalStockCapacity: number;
  storageLocationId: string;
  status: "ACTIVE" | "INACTIVE";
}

interface FormState {
  code: string;
  name: string;
  drawingNumber: string;
  specNumber: string;
  minimumQuantity: string;
  totalStockCapacity: string;
  storageLocationId: string;
  status: "ACTIVE" | "INACTIVE";
}

type Errors = Partial<Record<keyof FormState, string>>;

function toState(initial?: Partial<ToolFormValues>): FormState {
  return {
    code: initial?.code ?? "",
    name: initial?.name ?? "",
    drawingNumber: initial?.drawingNumber ?? "",
    specNumber: initial?.specNumber ?? "",
    minimumQuantity: String(initial?.minimumQuantity ?? 0),
    totalStockCapacity: String(initial?.totalStockCapacity ?? 0),
    storageLocationId: initial?.storageLocationId ?? "",
    status: initial?.status ?? "ACTIVE",
  };
}

function validate(v: FormState): Errors {
  const errors: Errors = {};
  if (!v.code.trim()) errors.code = "Tool code is required.";
  if (!v.name.trim()) errors.name = "Tool name is required.";
  if (!v.storageLocationId) errors.storageLocationId = "Choose a storage location.";
  for (const key of ["minimumQuantity", "totalStockCapacity"] as const) {
    const raw = v[key].trim();
    if (raw === "") errors[key] = "Enter a number (0 or more).";
    else if (!/^\d+$/.test(raw)) errors[key] = "Use a whole number, 0 or more.";
  }
  return errors;
}

export default function ToolForm({
  mode,
  toolId,
  version,
  initialValues,
}: {
  mode: "create" | "edit";
  toolId?: string;
  version?: number;
  initialValues?: Partial<ToolFormValues>;
}) {
  const router = useRouter();
  const [locations, setLocations] = useState<StorageLocation[]>([]);
  const [values, setValues] = useState<FormState>(() => toState(initialValues));
  const [errors, setErrors] = useState<Errors>({});
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiClient
      .get<{ data: StorageLocation[] }>("/storage-locations")
      .then((res) => {
        setLocations(res.data);
        if (mode === "create" && res.data.length === 1) {
          setValues((prev) => (prev.storageLocationId ? prev : { ...prev, storageLocationId: res.data[0].id }));
        }
      })
      .catch(() => setError("Failed to load storage locations."));
  }, [mode]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setValues((prev) => {
      const next = { ...prev, [key]: value };
      if (submitted) setErrors(validate(next));
      return next;
    });
  }

  async function addLocation(name: string) {
    const res = await apiClient.post<{ data: StorageLocation }>("/storage-locations", { name });
    setLocations((prev) => [...prev, res.data].sort((a, b) => a.name.localeCompare(b.name)));
    update("storageLocationId", res.data.id);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitted(true);
    const found = validate(values);
    setErrors(found);
    if (Object.keys(found).length) return;

    const payload = {
      ...values,
      code: values.code.trim(),
      name: values.name.trim(),
      minimumQuantity: Number(values.minimumQuantity),
      totalStockCapacity: Number(values.totalStockCapacity),
    };

    setSubmitting(true);
    try {
      if (mode === "create") {
        const res = await apiClient.post<{ data: { id: string } }>("/tools", payload);
        router.push(`/app/tools/${res.data.id}`);
      } else if (toolId) {
        await apiClient.patch(`/tools/${toolId}`, { ...payload, version });
        router.push(`/app/tools/${toolId}`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to save tool.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card flex max-w-2xl flex-col gap-4 p-6" noValidate>
      {error && <Alert>{error}</Alert>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Tool code" required error={errors.code}>
          <Input value={values.code} onChange={(e) => update("code", e.target.value)} maxLength={50} />
        </Field>
        <Field label="Tool name" required error={errors.name}>
          <Input value={values.name} onChange={(e) => update("name", e.target.value)} maxLength={200} />
        </Field>
        <Field label="Drawing number">
          <Input value={values.drawingNumber} onChange={(e) => update("drawingNumber", e.target.value)} maxLength={100} />
        </Field>
        <Field label="Spec number">
          <Input value={values.specNumber} onChange={(e) => update("specNumber", e.target.value)} maxLength={100} />
        </Field>
        <Field label="Minimum quantity" required error={errors.minimumQuantity}>
          <Input type="number" inputMode="numeric" min={0} step={1} value={values.minimumQuantity} onChange={(e) => update("minimumQuantity", e.target.value)} />
        </Field>
        <Field label="Total stock capacity" required error={errors.totalStockCapacity}>
          <Input type="number" inputMode="numeric" min={0} step={1} value={values.totalStockCapacity} onChange={(e) => update("totalStockCapacity", e.target.value)} />
        </Field>
        <Field label="Storage location" required error={errors.storageLocationId}>
          <Select value={values.storageLocationId} onChange={(e) => update("storageLocationId", e.target.value)}>
            <option value="">{locations.length === 0 ? "No locations yet — add one below" : "Select a location…"}</option>
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>{loc.name} ({loc.code})</option>
            ))}
          </Select>
        </Field>
        <Field label="Status" required>
          <Select value={values.status} onChange={(e) => update("status", e.target.value as "ACTIVE" | "INACTIVE")}>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <QuickAdd label="Add storage location" placeholder="New storage location name" onAdd={addLocation} />
        </div>
      </div>

      <p className="text-xs text-[var(--color-text-muted)]">
        Creating or editing a tool record does not change stock quantities. Record a movement (for example a Receipt) to add opening stock.
      </p>

      <div className="flex gap-3">
        <Button type="submit" disabled={submitting}>
          {submitting ? "Saving…" : mode === "create" ? "Create tool" : "Save changes"}
        </Button>
        <Button variant="secondary" onClick={() => router.back()}>Cancel</Button>
      </div>
    </form>
  );
}
