"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { apiClient, ApiError } from "@/lib/apiClient";
import { useAccess } from "@/lib/usePermissions";
import { Badge } from "@/components/ui/Badge";
import { Alert } from "@/components/ui/Alert";
import { Button, LinkButton } from "@/components/ui/Button";
import { Emoji } from "@/components/ui/Emoji";
import ScopeBar from "@/components/layout/ScopeBar";
import { Input, Select } from "@/components/ui/Input";
import { Pagination } from "@/components/ui/Pagination";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Skeleton, TableSkeleton } from "@/components/ui/Skeleton";
import { Table, Td, Th } from "@/components/ui/Table";
import { useDebounced } from "@/lib/useDebounced";

interface Summary {
  toolTypeCount: number;
  availableStockUnits: number;
  lowStockToolCount: number;
  sharpeningUnits: number;
  scrappedUnits: number;
  outOfStockToolCount: number;
}

interface ToolRow {
  id: string;
  code: string;
  name: string;
  minimumQuantity: number;
  availableQuantity: number;
  location: string | null;
  drawingNumber: string | null;
  specNumber: string | null;
  status: string;
  stockStatus: "OK" | "LOW_STOCK" | "OUT_OF_STOCK";
}

type StockFilter = "ALL" | "OK" | "LOW" | "OUT" | "AVAILABLE" | "SHARPENING" | "SCRAPPED";

const FILTER_LABELS: Record<StockFilter, string> = {
  ALL: "All tools",
  OK: "OK",
  LOW: "Low stock",
  OUT: "Out of stock",
  AVAILABLE: "Has available stock",
  SHARPENING: "In sharpening",
  SCRAPPED: "Scrapped",
};
const FILTERS = Object.keys(FILTER_LABELS) as StockFilter[];

const METRIC_CARDS: { key: keyof Summary; label: string; icon: string; filter: StockFilter; accent: string; unit: string }[] = [
  { key: "toolTypeCount", label: "Total Tool Types", icon: "🧰", filter: "ALL", accent: "var(--color-info)", unit: "tool types" },
  { key: "availableStockUnits", label: "Total Available Stock", icon: "✅", filter: "AVAILABLE", accent: "var(--color-success)", unit: "units" },
  { key: "lowStockToolCount", label: "Low Stock", icon: "⚠️", filter: "LOW", accent: "var(--color-warning)", unit: "tools" },
  { key: "sharpeningUnits", label: "In Sharpening", icon: "🔧", filter: "SHARPENING", accent: "var(--color-processing)", unit: "units" },
  { key: "scrappedUnits", label: "Scrapped", icon: "🗑️", filter: "SCRAPPED", accent: "var(--color-neutral)", unit: "units" },
  { key: "outOfStockToolCount", label: "Out of Stock", icon: "⛔", filter: "OUT", accent: "var(--color-danger)", unit: "tools" },
];

const BADGES = {
  OK: { label: "OK", tone: "success" },
  LOW_STOCK: { label: "Low stock", tone: "warning" },
  OUT_OF_STOCK: { label: "Out of stock", tone: "danger" },
} as const;

const PAGE_SIZE = 10;

export default function DashboardPage() {
  return (
    <Suspense fallback={null}>
      <Dashboard />
    </Suspense>
  );
}

function Dashboard() {
  const access = useAccess();
  const session = access?.session;
  const canCreateTool = access?.permissions.has("tool.create") ?? false;
  const canUpdateTool = access?.permissions.has("tool.update") ?? false;
  const canRecord = access?.permissions.has("movement.create") ?? false;
  const canDeleteTool = access?.permissions.has("tool.delete") ?? false;

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const rawFilter = searchParams.get("stock");
  const stock: StockFilter = FILTERS.includes(rawFilter as StockFilter) ? (rawFilter as StockFilter) : "ALL";
  const recordStatus = searchParams.get("status") ?? "";

  const [summary, setSummary] = useState<Summary | null>(null);
  const [result, setResult] = useState<{ key: string; rows: ToolRow[]; total: number } | null>(null);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const search = useDebounced(searchInput.trim(), 300);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ToolRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    setError(null);
    setMessage(null);
    try {
      await apiClient.delete(`/tools/${deleting.id}`);
      setMessage(`Tool ${deleting.code} deleted.`);
      setPage(1);
      setReloadToken((n) => n + 1);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to delete the tool.");
    } finally {
      setDeleteBusy(false);
      setDeleting(null);
    }
  }
  // Filters live in the URL so a card click, the dropdown and shared links all agree.
  function setParam(name: string, value: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (value && value !== "ALL") next.set(name, value);
    else next.delete(name);
    setPage(1);
    router.replace(next.size ? `${pathname}?${next}` : pathname, { scroll: false });
  }

  useEffect(() => {
    apiClient
      .get<{ data: Summary }>("/inventory/summary")
      .then((res) => setSummary(res.data))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load summary."));
  }, [reloadToken]);

  // Rows belong to the filters that produced them; a different key means a fetch is in flight.
  const listKey = [page, search, stock, recordStatus].join("|");
  const tools = result?.key === listKey ? result.rows : null;
  const total = result?.key === listKey ? result.total : 0;

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (search) params.set("search", search);
    if (recordStatus) params.set("status", recordStatus);
    if (stock !== "ALL") params.set("stock", stock);
    apiClient
      .get<{ data: ToolRow[]; pagination: { total: number } }>(`/tools?${params}`)
      .then((res) => {
        if (cancelled) return;
        setResult({ key: listKey, rows: res.data, total: res.pagination.total });
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Failed to load tools.");
      });
    return () => {
      cancelled = true;
    };
  }, [page, search, stock, recordStatus, listKey, reloadToken]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtersActive = Boolean(search || recordStatus || stock !== "ALL");

  function clearFilters() {
    setSearchInput("");
    setPage(1);
    router.replace(pathname, { scroll: false });
  }

  return (
    <div className="mx-auto max-w-screen-2xl px-2 py-6">
      <LinkButton href="/app/projects" variant="secondary" size="sm" className="mb-4">
        ← Back to Parts
      </LinkButton>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <h1 className="page-heading text-3xl font-bold"><Emoji className="mr-2">📊</Emoji>Inventory Dashboard</h1>
          <ScopeBar />
        </div>
        <div className="flex gap-2">
          {canCreateTool && session?.project && <LinkButton href="/app/tools/new">➕ Add Tool</LinkButton>}
        </div>
      </div>

      {error && <Alert className="mb-4">{error}</Alert>}
      {message && <Alert tone="success" className="mb-4">{message}</Alert>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" role="group" aria-label="Filter tools by stock">
        {METRIC_CARDS.map((card) => {
          const active = stock === card.filter;
          const next = new URLSearchParams(searchParams.toString());
          if (card.filter === "ALL") next.delete("stock");
          else next.set("stock", card.filter);
          return (
            <Link
              key={card.key}
              href={next.size ? `${pathname}?${next}` : pathname}
              scroll={false}
              onClick={() => setPage(1)}
              aria-current={active ? "true" : undefined}
              aria-label={`${card.label}: ${summary ? summary[card.key] : "loading"} ${card.unit}. Show ${FILTER_LABELS[card.filter].toLowerCase()}`}
              className={`card block p-4 text-[var(--color-text)] transition-shadow hover:no-underline hover:shadow-md ${
                active ? "ring-2 ring-[var(--color-primary)]" : ""
              }`}
              style={{ borderTopColor: card.accent, borderTopWidth: 3 }}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-[var(--color-text-muted)]">{card.label}</p>
                <span
                  aria-hidden="true"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-base"
                  style={{ backgroundColor: `color-mix(in srgb, ${card.accent} 12%, white)` }}
                >
                  {card.icon}
                </span>
              </div>
              {summary ? (
                <p className="mt-1 text-2xl font-semibold" style={{ color: card.accent }}>{summary[card.key]}</p>
              ) : (
                <Skeleton className="mt-2 h-7 w-12" />
              )}
            </Link>
          );
        })}
      </div>

      <div className="card mt-6 p-4">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="min-w-[220px] flex-1">
            <Input
              type="search"
              placeholder="🔍 Search code, name, drawing no., spec no."
              value={searchInput}
              onChange={(e) => {
                setPage(1);
                setSearchInput(e.target.value);
              }}
              aria-label="Search tools"
            />
          </div>
          <div className="w-44">
            <Select value={stock} onChange={(e) => setParam("stock", e.target.value)} aria-label="Filter by stock health">
              {FILTERS.map((f) => (
                <option key={f} value={f}>{FILTER_LABELS[f]}</option>
              ))}
            </Select>
          </div>
          <div className="w-36">
            <Select value={recordStatus} onChange={(e) => setParam("status", e.target.value)} aria-label="Filter by tool status">
              <option value="">Any status</option>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </Select>
          </div>
        </div>

        {tools === null && !error && <TableSkeleton rows={5} columns={6} />}

        {tools && tools.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            {filtersActive ? (
              <>
                <h2 className="text-base font-semibold"><Emoji className="mr-1.5">🔎</Emoji>No tools match your filters</h2>
                <button type="button" onClick={clearFilters} className="text-sm text-[var(--color-primary)] underline">
                  Clear filters
                </button>
              </>
            ) : (
              <>
                <h2 className="text-base font-semibold"><Emoji className="mr-1.5">🧰</Emoji>No tools yet</h2>
                <p className="max-w-sm text-sm text-[var(--color-text-muted)]">
                  {canCreateTool
                    ? "Add the first tool to start tracking stock in this workspace."
                    : "Tools added to this workspace will appear here."}
                </p>
                {canCreateTool && session?.project && <LinkButton href="/app/tools/new">➕ Add Tool</LinkButton>}
              </>
            )}
          </div>
        )}

        {tools && tools.length > 0 && (
          <Table caption="Tool inventory">
            <thead>
              <tr>
                <Th>Code</Th>
                <Th>Tool Name</Th>
                <Th>Min Qty</Th>
                <Th>Available</Th>
                <Th>Location</Th>
                <Th>Drawing No.</Th>
                <Th>Spec No.</Th>
                <Th>Status</Th>
                {(canUpdateTool || canRecord || canDeleteTool) && <Th>Actions</Th>}
              </tr>
            </thead>
            <tbody>
              {tools.map((tool) => {
                const badge = BADGES[tool.stockStatus];
                return (
                  <tr key={tool.id}>
                    <Td className="whitespace-nowrap font-medium">{tool.code}</Td>
                    <Td className="min-w-[16rem] max-w-xl whitespace-normal break-words text-base font-medium">
                      <Link href={`/app/tools/${tool.id}`}>{tool.name}</Link>
                    </Td>
                    <Td>{tool.minimumQuantity}</Td>
                    <Td className="font-semibold">{tool.availableQuantity}</Td>
                    <Td>{tool.location ?? "—"}</Td>
                    <Td>{tool.drawingNumber ?? "—"}</Td>
                    <Td>{tool.specNumber ?? "—"}</Td>
                    <Td><Badge tone={badge.tone}>{badge.label}</Badge></Td>
                    {(canUpdateTool || canRecord || canDeleteTool) && (
                      <Td>
                        <div className="flex gap-2">
                          {canUpdateTool && <LinkButton href={`/app/tools/${tool.id}/edit`} variant="secondary" size="sm">✏️ Edit</LinkButton>}
                          {canRecord && <LinkButton href={`/app/tools/${tool.id}/movements/new`} size="sm">⚙️ Manage</LinkButton>}
                          {canDeleteTool && (
                            <Button variant="danger" size="sm" onClick={() => setDeleting(tool)}>🗑️ Delete</Button>
                          )}
                        </div>
                      </Td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}

        {tools && tools.length > 0 && (
          <Pagination page={page} totalPages={totalPages} total={total} noun="tool" onPageChange={setPage} />
        )}
      </div>

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete this tool?"
        confirmLabel="Delete tool"
        destructive
        busy={deleteBusy}
        onCancel={() => setDeleting(null)}
        onConfirm={confirmDelete}
      >
        {deleting && (
          <>
            Delete <strong>{deleting.name}</strong> ({deleting.code})? This cannot be undone. Tools that already have
            movement history cannot be deleted; set them to Inactive instead.
          </>
        )}
      </ConfirmDialog>
    </div>
  );
}
