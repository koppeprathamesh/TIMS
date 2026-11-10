"use client";

import { useState } from "react";
import Link from "next/link";
import { apiClient, ApiError } from "@/lib/apiClient";
import { AuthBrand } from "@/components/ui/AuthBrand";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Input";
import { Alert } from "@/components/ui/Alert";
import { PasswordInput } from "@/components/ui/PasswordInput";

// The seed-account hint is development-only; production builds never render it.
const SHOW_SEED_HINT = process.env.NODE_ENV !== "production";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const errors: typeof fieldErrors = {};
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) errors.email = "Enter a valid email address.";
    if (!password) errors.password = "Enter your password.";
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;

    setLoading(true);
    try {
      await apiClient.post("/auth/login", { email, password });
      // Full reload so no client state from a previous user/role survives. Every sign-in starts
      // at the facility cards.
      window.location.assign("/app/workspace");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to sign in. Please try again.");
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--color-surface)] px-4">
      <div className="card w-full max-w-md p-10">
        <AuthBrand />

        <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-4" noValidate>
          <Field label="Email" required error={fieldErrors.email}>
            <Input name="email" type="email" autoComplete="username" placeholder="Enter your email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Password" required error={fieldErrors.password}>
            <PasswordInput name="password" placeholder="Enter your password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>

          {error && <Alert>{error}</Alert>}

          <Button type="submit" disabled={loading} className="mt-2 w-full rounded-full py-3">
            {loading ? "Signing in…" : "Sign In"}
          </Button>
          <Link href="/forgot-password" className="text-center text-sm font-medium">
            Forgot Password?
          </Link>
        </form>

        {SHOW_SEED_HINT && (
          <p className="mt-6 text-xs text-[var(--color-text-muted)]">
            Development seed accounts: admin@etgroupindia.com / Password123!
          </p>
        )}
      </div>
    </main>
  );
}
