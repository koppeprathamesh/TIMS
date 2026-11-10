"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import ToolForm, { type ToolFormValues } from "@/components/forms/ToolForm";
import { apiClient, ApiError } from "@/lib/apiClient";
import { Alert } from "@/components/ui/Alert";
import { Skeleton } from "@/components/ui/Skeleton";

interface ToolDetail extends ToolFormValues {
  id: string;
  version: number;
  defaultLocationId: string | null;
}

export default function EditToolPage() {
  return (
    <Suspense fallback={null}>
      <EditToolPageInner />
    </Suspense>
  );
}

function EditToolPageInner() {
  const params = useParams<{ toolId: string }>();
  const [tool, setTool] = useState<ToolDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .get<{ data: ToolDetail }>(`/tools/${params.toolId}`)
      .then((res) => setTool(res.data))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load tool."));
  }, [params.toolId]);

  if (error) return <div className="mx-auto max-w-3xl px-2 py-6"><Alert>{error}</Alert></div>;
  if (!tool) {
    return (
      <div className="mx-auto max-w-3xl space-y-3 px-2 py-6" role="status" aria-label="Loading tool">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-2 py-6">
      <h1 className="page-heading mb-4 text-2xl font-semibold">Edit Tool</h1>
      <ToolForm
        mode="edit"
        toolId={tool.id}
        version={tool.version}
        initialValues={{
          code: tool.code,
          name: tool.name,
          drawingNumber: tool.drawingNumber ?? "",
          specNumber: tool.specNumber ?? "",
          minimumQuantity: tool.minimumQuantity,
          totalStockCapacity: tool.totalStockCapacity,
          storageLocationId: tool.defaultLocationId ?? "",
          status: tool.status,
        }}
      />
    </div>
  );
}
