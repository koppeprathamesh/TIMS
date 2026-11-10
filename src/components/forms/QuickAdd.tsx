"use client";

import { useState } from "react";
import { ApiError } from "@/lib/apiClient";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

// Inline "add new …" control so a missing location or machine never blocks the form being filled in.
export function QuickAdd({
  label,
  placeholder,
  onAdd,
}: {
  label: string;
  placeholder: string;
  onAdd: (name: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    if (!name.trim()) {
      setError("Enter a name.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onAdd(name.trim());
      setName("");
      setOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to add.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)} className="self-start">
        ➕ {label}
      </Button>
    );
  }
  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void add();
            }
          }}
          placeholder={placeholder}
          aria-label={placeholder}
          maxLength={100}
          autoFocus
        />
        <Button size="sm" onClick={add} disabled={busy}>{busy ? "Adding…" : "Add"}</Button>
        <Button size="sm" variant="ghost" onClick={() => { setOpen(false); setError(null); }} disabled={busy}>Cancel</Button>
      </div>
      {error && <p role="alert" className="text-xs text-[var(--color-danger)]">{error}</p>}
    </div>
  );
}
