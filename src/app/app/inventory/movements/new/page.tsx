"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import MovementForm from "@/components/forms/MovementForm";

export default function NewMovementPage() {
  return (
    <Suspense fallback={null}>
      <NewMovement />
    </Suspense>
  );
}

function NewMovement() {
  const toolId = useSearchParams().get("toolId") ?? undefined;
  return (
    <div className="mx-auto max-w-3xl px-2 py-6">
      <h1 className="page-heading mb-4 text-2xl font-semibold">Record Inventory Movement</h1>
      <MovementForm initialToolId={toolId} returnTo="/app/inventory/movements" />
    </div>
  );
}
