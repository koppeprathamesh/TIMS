"use client";

import { useState } from "react";
import ImageField from "@/components/forms/ImageField";

export interface EntityFormValues {
  name: string;
  code: string;
  description: string;
  imageUrl: string;
}

const controlClass =
  "rounded-[var(--radius-control)] border border-[var(--color-border)] px-3 py-2 text-sm";

// Create/edit form shared by facilities and departments (title, image, description).
export default function EntityForm({
  label,
  initial,
  showCode,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  label: string;
  initial?: Partial<EntityFormValues>;
  /** The code is only editable when creating. */
  showCode: boolean;
  submitLabel: string;
  onSubmit: (values: EntityFormValues) => Promise<void>;
  onCancel?: () => void;
}) {
  const [values, setValues] = useState<EntityFormValues>({
    name: initial?.name ?? "",
    code: initial?.code ?? "",
    description: initial?.description ?? "",
    imageUrl: initial?.imageUrl ?? "",
  });
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await onSubmit(values);
      if (showCode) setValues({ name: "", code: "", description: "", imageUrl: "" });
    } catch {
      // The caller surfaces the error; keep the entered values for correction.
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} aria-label={label} className="card space-y-3 p-4">
      <h2 className="text-lg font-semibold">{label}</h2>
      <div className="flex flex-wrap gap-3">
        <input
          required
          value={values.name}
          onChange={(e) => setValues({ ...values, name: e.target.value })}
          placeholder="Title"
          aria-label="Title"
          className={`${controlClass} w-64`}
        />
        {showCode && (
          <input
            required
            value={values.code}
            onChange={(e) => setValues({ ...values, code: e.target.value })}
            placeholder="Code (e.g. MX107-B4)"
            aria-label="Code"
            className={`${controlClass} w-48`}
          />
        )}
      </div>
      <textarea
        value={values.description}
        onChange={(e) => setValues({ ...values, description: e.target.value })}
        placeholder="Description / information"
        aria-label="Description"
        rows={3}
        maxLength={2000}
        className={`${controlClass} w-full max-w-xl`}
      />
      <ImageField value={values.imageUrl} onChange={(imageUrl) => setValues({ ...values, imageUrl })} />
      <div className="flex gap-3">
        <button type="submit" disabled={busy} className="btn-primary px-4 py-2 text-sm disabled:opacity-60">
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="text-sm hover:underline" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
