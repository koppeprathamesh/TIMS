"use client";

import { useSyncExternalStore } from "react";
import { z } from "zod";
import { apiClient, ApiError } from "@/lib/apiClient";
import { isRoleCode } from "@/lib/authz/permissions";
import type { NavigationSession } from "@/lib/navigation";

export type RoleCode = "SUPER_ADMIN" | "INVENTORY_ADMIN" | "USER";

export const ROLE_LABELS: Record<RoleCode, string> = {
  SUPER_ADMIN: "Super Admin",
  INVENTORY_ADMIN: "Inventory Admin",
  USER: "User",
};

export interface Access {
  role: RoleCode;
  permissions: Set<string>;
  session: NavigationSession;
}

interface AccessState {
  access: Access | null;
  error: Error | null;
  verifiedPath: string | null;
}

const entitySchema = z.object({ id: z.string(), name: z.string() });
const sessionSchema = z.object({
  user: z.object({ id: z.string(), displayName: z.string(), email: z.string() }),
  organization: entitySchema.nullable(),
  facility: entitySchema.nullable(),
  department: entitySchema.nullable(),
  project: entitySchema.nullable(),
  workspaceStep: z.enum(["facility", "department", "project", "ready"]),
  role: z.custom<RoleCode>(isRoleCode),
  permissions: z.array(z.string()),
});

const initialState: AccessState = { access: null, error: null, verifiedPath: null };
let state = initialState;
let accessPromise: Promise<void> | null = null;
let pendingPath: string | null = null;
let generation = 0;
const listeners = new Set<() => void>();

function publish(next: AccessState) {
  state = next;
  listeners.forEach((listener) => listener());
}

// All consumers, including cached pages, receive the same load and retry result.
// The verified session is cached across navigations: later loads revalidate in the background
// (stale-while-revalidate) so moving between pages never blanks the screen. The API still
// enforces every permission, so a briefly stale cache can only affect what is shown.
export const accessStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  getSnapshot: () => state,
  getServerSnapshot: () => initialState,
  // Drops the cached identity entirely (sign-out, expired session).
  invalidate() {
    generation++;
    accessPromise = null;
    pendingPath = null;
    publish(initialState);
  },
  // Re-reads the session after a change (e.g. a new workspace) without clearing the cache.
  refresh(path?: string): Promise<void> {
    return accessStore.load(path ?? state.verifiedPath ?? "/", true);
  },
  load(path: string, force = false): Promise<void> {
    if (!force && accessPromise && pendingPath === path) return accessPromise;
    if (!force && state.access && state.verifiedPath === path && !state.error) return Promise.resolve();
    const requestGeneration = ++generation;
    pendingPath = path;
    if (state.error) publish({ ...state, error: null });
    accessPromise = apiClient
      .get<unknown>("/auth/session", { cache: "no-store" })
      .then((response) => {
        const parsed = sessionSchema.safeParse(response);
        if (!parsed.success) throw new Error("The server returned invalid session permissions. Please try again.");
        if (requestGeneration !== generation) return;
        const session = parsed.data;
        publish({
          access: { role: session.role, permissions: new Set(session.permissions), session },
          error: null,
          verifiedPath: path,
        });
      })
      .catch((error: unknown) => {
        if (requestGeneration !== generation) return;
        if (error instanceof ApiError && error.status === 401) {
          publish({ access: null, error: null, verifiedPath: path });
        } else if (state.access) {
          // A failed background refresh keeps the cached session rather than blanking the page.
          publish({ ...state, error: null, verifiedPath: path });
        } else {
          publish({
            access: null,
            error: error instanceof Error ? error : new Error("Unable to load your permissions."),
            verifiedPath: path,
          });
        }
      })
      .finally(() => {
        if (requestGeneration === generation) {
          accessPromise = null;
          pendingPath = null;
        }
      });
    return accessPromise;
  },
};

export function useAccessState(): AccessState {
  return useSyncExternalStore(
    accessStore.subscribe,
    accessStore.getSnapshot,
    accessStore.getServerSnapshot
  );
}

// UI gating is a convenience; the API enforces every permission and scope.
export function useAccess(): Access | null {
  return useAccessState().access;
}

export function usePermissions(): Set<string> | null {
  return useAccess()?.permissions ?? null;
}
