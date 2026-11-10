"use client";

import { useState } from "react";
import Link from "next/link";
import { apiClient, ApiError } from "@/lib/apiClient";
import { AuthBrand } from "@/components/ui/AuthBrand";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Input";
import { Alert } from "@/components/ui/Alert";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setFieldError("Enter a valid email address.");
    setFieldError(null);
    setLoading(true);
    try {
      const res = await apiClient.post<{ message: string }>("/auth/forgot-password", { email });
      setMessage(res.message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to send the reset link. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--color-surface)] px-4">
      <div className="card w-full max-w-sm p-8">
        <AuthBrand subtitle="Reset your password" />
        {message ? (
          <div className="mt-6 space-y-4">
            <Alert tone="success">{message}</Alert>
            <p className="text-sm text-[var(--color-text-muted)]">
              The link expires in 30 minutes. If nothing arrives, ask a Super Admin to reset your password from the Users page.
            </p>
            <Link href="/login" className="text-sm">Back to sign in</Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4" noValidate>
            <p className="text-sm text-[var(--color-text-muted)]">Enter your account email and we will send you a link to choose a new password.</p>
            <Field label="Email" required error={fieldError}>
              <Input name="email" type="email" autoComplete="username" value={email} placeholder="name@etgroupindia.com" onChange={(e) => setEmail(e.target.value)} />
            </Field>
            {error && <Alert>{error}</Alert>}
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? "Sending…" : "Send reset link"}
            </Button>
            <Link href="/login" className="text-center text-sm">Back to sign in</Link>
          </form>
        )}
      </div>
    </main>
  );
}
