"use client";

import { useCallback, useEffect, useState } from "react";
import { apiClient, ApiError } from "@/lib/apiClient";

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  message: string;
  readAt: string | null;
  createdAt: string;
}

export default function NotificationsPage() {
  const [items, setItems] = useState<NotificationRow[] | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    apiClient
      .get<{ items: NotificationRow[]; unreadCount: number }>("/notifications")
      .then((r) => {
        setItems(r.items);
        setUnreadCount(r.unreadCount);
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load notifications."));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function act(action: () => Promise<unknown>) {
    try {
      await action();
      load();
      window.dispatchEvent(new Event("tims:notifications-changed"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The action failed.");
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-2 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="page-heading text-2xl font-semibold">Notifications</h1>
        <button
          disabled={unreadCount === 0}
          onClick={() => act(() => apiClient.post("/notifications/read-all"))}
          className="rounded-[var(--radius-control)] border border-[var(--color-border)] px-3 py-2 text-sm disabled:opacity-50"
        >
          Mark all read
        </button>
      </div>

      {error && <p role="alert" className="mb-3 text-sm text-[var(--color-danger)]">{error}</p>}
      {items === null && !error && <p className="text-sm text-[var(--color-text-muted)]">Loading…</p>}
      {items && items.length === 0 && (
        <div className="card p-4 text-sm text-[var(--color-text-muted)]">No notifications.</div>
      )}

      {items && items.length > 0 && (
        <ul className="space-y-2">
          {items.map((n) => (
            <li key={n.id} className="card flex items-start justify-between gap-3 p-4">
              <div>
                <p className={n.readAt ? "text-sm" : "text-sm font-semibold"}>{n.title}</p>
                <p className="text-sm text-[var(--color-text-muted)]">{n.message}</p>
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">{new Date(n.createdAt).toLocaleString()}</p>
              </div>
              {!n.readAt && (
                <button className="shrink-0 text-sm hover:underline" onClick={() => act(() => apiClient.post(`/notifications/${n.id}/read`))}>
                  Mark read
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
