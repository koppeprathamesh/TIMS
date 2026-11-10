"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { apiClient, ApiError } from "@/lib/apiClient";
import { AuthBrand } from "@/components/ui/AuthBrand";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Input";
import { Alert } from "@/components/ui/Alert";
import { PasswordInput } from "@/components/ui/PasswordInput";

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}

function passwordProblem(password: string) {
  if (password.length < 10) return "Password must be at least 10 characters.";
  if (!/[A-Za-z]/.test(password)) return "Password must contain a letter.";
  if (!/\d/.test(password)) return "Password must contain a digit.";
  return null;
}

function ResetPasswordForm() {
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const next: typeof errors = {};
    const problem = passwordProblem(password);
    if (problem) next.password = problem;
    if (confirm !== password) next.confirm = "Passwords do not match.";
    setErrors(next);
    if (Object.keys(next).length) return;

    setLoading(true);
    try {
      await apiClient.post("/auth/reset-password", { token, password });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to reset your password. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--color-surface)] px-4">
      <div className="card w-full max-w-sm p-8">
        <AuthBrand subtitle="Choose a new password" />
        {done ? (
          <div className="mt-6 space-y-4">
            <Alert tone="success">Your password has been updated. You can now sign in.</Alert>
            <Link href="/login" className="text-sm">Go to sign in</Link>
          </div>
        ) : !token ? (
          <div className="mt-6 space-y-4">
            <Alert>This reset link is incomplete. Request a new one.</Alert>
            <Link href="/forgot-password" className="text-sm">Request a new link</Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4" noValidate>
            <Field label="New password" required error={errors.password} hint="At least 10 characters with a letter and a digit.">
              <PasswordInput autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <Field label="Confirm new password" required error={errors.confirm}>
              <PasswordInput autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </Field>
            {error && <Alert>{error}</Alert>}
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? "Saving…" : "Update password"}
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}
