import { beforeEach, describe, expect, it, vi } from "vitest";
import { ALL_PERMISSION_CODES } from "@/lib/authz/permissions";
import type { NavigationSession } from "@/lib/navigation";

const path = "/app/facilities";
function session(overrides: Partial<NavigationSession> = {}): NavigationSession {
  return {
    user: { id: "u1", displayName: "Admin", email: "admin@test.local" },
    organization: { id: "o1", name: "Organization" },
    facility: null,
    department: null,
    project: null,
    workspaceStep: "facility",
    role: "SUPER_ADMIN",
    permissions: ALL_PERMISSION_CODES,
    ...overrides,
  };
}

const get = vi.hoisted(() => vi.fn());
vi.mock("@/lib/apiClient", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/apiClient")>(),
  apiClient: { get },
}));

async function freshStore() {
  return (await import("@/lib/usePermissions")).accessStore;
}

beforeEach(() => {
  vi.resetModules();
  get.mockReset();
});

describe("shared client permissions", () => {
  it("starts loading without inventing a role or permissions", async () => {
    const store = await freshStore();
    expect(store.getSnapshot()).toEqual({ access: null, error: null, verifiedPath: null });
    expect(store.getServerSnapshot()).toEqual(store.getSnapshot());
  });

  it("shares concurrent loads and caches the verified Super Admin permissions", async () => {
    const store = await freshStore();
    get.mockResolvedValue(session());
    const first = store.load(path);
    expect(store.load(path)).toBe(first);
    await first;

    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith("/auth/session", { cache: "no-store" });
    expect(store.getSnapshot().access?.role).toBe("SUPER_ADMIN");
    expect([...store.getSnapshot().access!.permissions].sort()).toEqual([...ALL_PERMISSION_CODES].sort());
    await store.load(path);
    expect(get).toHaveBeenCalledTimes(1);
    // The server snapshot must not expose a browser's cached identity.
    expect(store.getServerSnapshot().access).toBeNull();
  });

  it("reports a failed request instead of silently downgrading the user", async () => {
    const store = await freshStore();
    const error = new Error("Network unavailable");
    get.mockRejectedValue(error);
    await store.load(path);
    expect(store.getSnapshot()).toEqual({ access: null, error, verifiedPath: path });
  });

  it("broadcasts a successful retry to every mounted consumer", async () => {
    const store = await freshStore();
    get.mockRejectedValueOnce(new Error("Temporary failure"));
    await store.load(path);
    const shell = vi.fn();
    const page = vi.fn();
    const unsubscribeShell = store.subscribe(shell);
    store.subscribe(page);

    get.mockResolvedValue(session());
    const retry = store.load(path, true);
    expect(store.getSnapshot()).toEqual({ access: null, error: null, verifiedPath: path });
    expect(store.load(path)).toBe(retry);
    await retry;

    expect(shell).toHaveBeenCalledTimes(2);
    expect(page).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot().access?.permissions.has("facility.manage")).toBe(true);
    expect(store.getSnapshot().access?.permissions.has("department.manage")).toBe(true);
    unsubscribeShell();
  });

  it("preserves a real empty permission set and read-only roles", async () => {
    const store = await freshStore();
    const response = session({ role: "USER", permissions: [] });
    get.mockResolvedValue(response);
    await store.load(path);
    expect(store.getSnapshot().access).toEqual({ role: "USER", permissions: new Set(), session: response });
    expect(store.getSnapshot().error).toBeNull();
  });

  it.each([
    { ...session(), role: "UNKNOWN" },
    { ...session(), permissions: null },
    { ...session(), permissions: [123] },
    { ...session(), workspaceStep: "unknown" },
  ])("rejects malformed access data: %j", async (response) => {
    const store = await freshStore();
    get.mockResolvedValue(response);
    await store.load(path);
    expect(store.getSnapshot().access).toBeNull();
    expect(store.getSnapshot().error?.message).toMatch(/invalid session permissions/i);
  });

  it("keeps the cached session while another destination is revalidated", async () => {
    const store = await freshStore();
    get.mockResolvedValueOnce(session()).mockResolvedValueOnce(session({ role: "USER", permissions: ["facility.read"] }));
    await store.load(path);
    const navigation = store.load("/app/workspace");
    // Navigation never blanks the screen: the previous verified session stays until the refresh lands.
    expect(store.getSnapshot().access?.role).toBe("SUPER_ADMIN");
    await navigation;
    expect(store.getSnapshot().access?.role).toBe("USER");
    expect(store.getSnapshot().verifiedPath).toBe("/app/workspace");
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("keeps the cached session when a background refresh fails", async () => {
    const store = await freshStore();
    get.mockResolvedValueOnce(session()).mockRejectedValueOnce(new Error("Network unavailable"));
    await store.load(path);
    await store.load("/app/workspace");
    expect(store.getSnapshot().access?.role).toBe("SUPER_ADMIN");
    expect(store.getSnapshot().error).toBeNull();
  });

  it("drops the cache entirely when the session has expired", async () => {
    const store = await freshStore();
    const { ApiError: CurrentApiError } = await import("@/lib/apiClient");
    get.mockResolvedValueOnce(session()).mockRejectedValueOnce(new CurrentApiError(401, "UNAUTHORIZED", "Expired"));
    await store.load(path);
    await store.load("/app/workspace");
    expect(store.getSnapshot()).toEqual({ access: null, error: null, verifiedPath: "/app/workspace" });
  });

  it("refresh re-reads the session without clearing it first", async () => {
    const store = await freshStore();
    get.mockResolvedValueOnce(session()).mockResolvedValueOnce(session({ facility: { id: "f1", name: "Plant" } }));
    await store.load(path);
    const refreshing = store.refresh();
    expect(store.getSnapshot().access).not.toBeNull();
    await refreshing;
    expect(store.getSnapshot().access?.session.facility?.name).toBe("Plant");
  });

  it("forces revalidation for same-path history restoration", async () => {
    const store = await freshStore();
    get.mockResolvedValue(session());
    await store.load(path);
    await store.load(path, true);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("does not allow an older request to overwrite a newer navigation", async () => {
    const store = await freshStore();
    let resolveOld!: (value: NavigationSession) => void;
    get.mockImplementationOnce(() => new Promise<NavigationSession>((resolve) => { resolveOld = resolve; }));
    const oldRequest = store.load(path);
    get.mockResolvedValueOnce(session({ role: "USER", permissions: [] }));
    await store.load("/select-facility");
    resolveOld(session());
    await oldRequest;
    expect(store.getSnapshot().verifiedPath).toBe("/select-facility");
    expect(store.getSnapshot().access?.role).toBe("USER");
  });

  it("supersedes an in-flight check when history forces same-path revalidation", async () => {
    const store = await freshStore();
    let resolveOld!: (value: NavigationSession) => void;
    get.mockImplementationOnce(() => new Promise<NavigationSession>((resolve) => { resolveOld = resolve; }));
    const oldRequest = store.load(path);
    get.mockResolvedValueOnce(session({ role: "USER", permissions: [] }));
    await store.load(path, true);
    resolveOld(session());
    await oldRequest;
    expect(get).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot().access?.role).toBe("USER");
  });

  it("invalidates requests started before a context change", async () => {
    const store = await freshStore();
    let resolveOld!: (value: NavigationSession) => void;
    get.mockImplementationOnce(() => new Promise<NavigationSession>((resolve) => { resolveOld = resolve; }));
    const oldRequest = store.load(path);
    store.invalidate();
    resolveOld(session());
    await oldRequest;
    expect(store.getSnapshot().verifiedPath).toBeNull();
    expect(store.getSnapshot().access).toBeNull();
  });

  it("distinguishes an expired session from a network failure", async () => {
    const store = await freshStore();
    // The module is reset between tests; use its current ApiError constructor.
    const { ApiError: CurrentApiError } = await import("@/lib/apiClient");
    get.mockRejectedValue(new CurrentApiError(401, "UNAUTHORIZED", "Session expired"));
    await store.load(path);
    expect(store.getSnapshot()).toEqual({ access: null, error: null, verifiedPath: path });
  });
});
