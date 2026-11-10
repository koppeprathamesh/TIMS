/* eslint-disable @next/next/no-img-element -- preview of user-supplied image */
"use client";

import { useId, useState } from "react";

const MAX_UPLOAD_BYTES = 500 * 1024;
const ACCEPTED = ["image/png", "image/jpeg", "image/webp", "image/gif"];

const controlClass =
  "rounded-[var(--radius-control)] border border-[var(--color-border)] px-3 py-2 text-sm";

// Accepts an http(s) image URL or an uploaded PNG/JPEG/WebP/GIF (stored as a data URL).
export default function ImageField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const inputId = useId();
  const [error, setError] = useState<string | null>(null);
  const isUpload = value.startsWith("data:");

  function handleFile(file: File | undefined) {
    setError(null);
    if (!file) return;
    if (!ACCEPTED.includes(file.type)) {
      setError("Use a PNG, JPEG, WebP or GIF image.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError("Image must be 500 KB or smaller.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => onChange(String(reader.result));
    reader.onerror = () => setError("Could not read the image.");
    reader.readAsDataURL(file);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="url"
          value={isUpload ? "" : value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={isUpload ? "Uploaded image in use" : "Image URL (https://…)"}
          aria-label="Image URL"
          className={`${controlClass} w-72`}
        />
        <label htmlFor={inputId} className="cursor-pointer text-sm text-[var(--color-primary)] underline">
          Upload image
        </label>
        <input
          id={inputId}
          type="file"
          accept={ACCEPTED.join(",")}
          className="sr-only"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
        {value && (
          <button type="button" className="text-sm hover:underline" onClick={() => onChange("")}>
            Remove
          </button>
        )}
      </div>
      {error && <p role="alert" className="text-xs text-[var(--color-danger)]">{error}</p>}
      {value && (
        <img src={value} alt="Preview" className="h-24 w-40 rounded border border-[var(--color-border)] object-cover" />
      )}
    </div>
  );
}
