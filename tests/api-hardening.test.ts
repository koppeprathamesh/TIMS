import bcrypt from "bcryptjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { signSession, SESSION_COOKIE_NAME, type SessionPayload } from "@/lib/auth/session";
import { clearAllRateLimits } from "@/lib/auth/rate-limit";
import { requestPasswordReset, resetPasswordWithToken } from "@/lib/auth/password-reset";
import { ROLES, permissionsForRole } from "@/lib/authz/permissions";
import { createMovement, approveMovement, reverseMovement } from "@/lib/inventory/engine";
import { updateUser } from "@/lib/admin/users";
import { sendMail } from "@/lib/mail";
import { POST as loginRoute } from "@/app/api/v1/auth/login/route";
import { GET as sessionRoute } from "@/app/api/v1/auth/session/route";
import { GET as listTools, POST as createTool } from "@/app/api/v1/tools/route";
import { GET as getTool, PATCH as patchTool } from "@/app/api/v1/tools/[toolId]/route";
import { GET as toolMovements } from "@/app/api/v1/tools/[toolId]/movements/route";
import { GET as listMovements } from "@/app/api/v1/inventory/movements/route";
import { GET as getSummary } from "@/app/api/v1/inventory/summary/route";
import { createFixture, createTool as makeTool } from "./helpers";
import { contextFor, createDepartment, createMember, createProject } from "./admin-helpers";

const auth = vi.hoisted(() => ({ token: null as string | null }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (auth.token ? { value: auth.token } : undefined) }),
}));
vi.mock("@/lib/mail", () => ({ sendMail: vi.fn().mockResolvedValue(true) }));

const PASSWORD = "Password123!";
let passwordHash: string;

beforeEach(async () => {
  auth.token = null;
  clearAllRateLimits();
  passwordHash ??= await hashPassword(PASSWORD);
});
afterEach(() => vi.restoreAllMocks());

const json = (url: string, init?: ConstructorParameters<typeof NextRequest>[1]) => new NextRequest(`http://localhost${url}`, init);
const params = (toolId: string) => ({ params: Promise.resolve({ toolId }) });
const signIn = (payload: SessionPayload) => { auth.token = signSession(payload); };

// Two departments with a project each, a tool per project, and a USER granted only the first.
async function twoDepartments() {
  const f = await createFixture();
  const deptA = await createDepartment(f.facility.id, "A");
  const deptB = await createDepartment(f.facility.id, "B");
  const projA = await createProject(f.org.id, deptA.id, "Project A");
  const projB = await createProject(f.org.id, deptB.id, "Project B");
  const toolA = await makeTool(f.org.id, { code: `TA-${projA.id}`, minimumQuantity: 2, projectId: projA.id });
  const toolB = await makeTool(f.org.id, { code: `TB-${projB.id}`, minimumQuantity: 2, projectId: projB.id });
  const user = await createMember(f.org.id, `scope-${f.org.id}@test.local`, { departmentIds: [deptA.id] });
  const workspace = { organizationId: f.org.id, facilityId: f.facility.id, departmentId: deptA.id, projectId: projA.id };
  return { f, deptA, deptB, projA, projB, toolA, toolB, user, workspace };
}

describe("scope is enforced the same way everywhere", () => {
  it("hides tools outside the user's grants from detail, edit and history routes", async () => {
    const s = await twoDepartments();
    signIn({ userId: s.user.id, ...s.workspace });

    const own = await getTool(json(`/api/v1/tools/${s.toolA.id}`), params(s.toolA.id));
    expect(own.status).toBe(200);
    const body = (await own.json()).data;
    expect(body.code).toBe(s.toolA.code);
    for (const internal of ["organizationId", "createdById", "updatedById", "projectId"]) expect(body).not.toHaveProperty(internal);

    expect((await getTool(json(`/api/v1/tools/${s.toolB.id}`), params(s.toolB.id))).status).toBe(404);
    expect((await toolMovements(json(`/api/v1/tools/${s.toolB.id}/movements`), params(s.toolB.id))).status).toBe(404);
  });

  it("refuses edits to tools the dashboard hides", async () => {
    const s = await twoDepartments();
    const admin = await createMember(s.f.org.id, `adm-${s.f.org.id}@test.local`, { role: ROLES.INVENTORY_ADMIN, facilityIds: [s.f.facility.id] });
    signIn({ userId: admin.id, ...s.workspace });
    const patch = (toolId: string) =>
      patchTool(json(`/api/v1/tools/${toolId}`, { method: "PATCH", body: JSON.stringify({ name: "Renamed", version: 1 }) }), params(toolId));
    expect((await patch(s.toolA.id)).status).toBe(200);
    expect((await patch(s.toolB.id)).status).toBe(404);
  });

  it("keeps dashboard counts, tool list and summary consistent for the selected project", async () => {
    const s = await twoDepartments();
    signIn({ userId: s.user.id, ...s.workspace });
    const list = await (await listTools(json("/api/v1/tools"))).json();
    const summary = (await (await getSummary()).json()).data;
    expect(list.pagination.total).toBe(1);
    expect(summary.toolTypeCount).toBe(1);
    expect(summary.outOfStockToolCount).toBe(1);

    const out = await (await listTools(json("/api/v1/tools?stock=OUT"))).json();
    expect(out.data.map((t: { id: string }) => t.id)).toEqual([s.toolA.id]);
    const ok = await (await listTools(json("/api/v1/tools?stock=OK"))).json();
    expect(ok.data).toEqual([]);
  });

  it("limits movement history to tools in scope and returns only UI fields", async () => {
    const s = await twoDepartments();
    const post = (toolId: string) =>
      createMovement(s.f.ctx, {
        facilityId: s.f.facility.id,
        movementType: "RECEIPT", grnNumber: "GRN1",
        lines: [{ toolId, quantity: 3, destinationLocationId: s.f.locA.id }],
      });
    const movementA = await post(s.toolA.id);
    const movementB = await post(s.toolB.id);

    signIn({ userId: s.user.id, ...s.workspace });
    const res = await listMovements(json("/api/v1/inventory/movements"));
    const { data } = await res.json();
    expect(data.map((m: { id: string }) => m.id)).toEqual([movementA.id]);
    expect(data.map((m: { id: string }) => m.id)).not.toContain(movementB.id);
    const row = data[0];
    for (const internal of ["organizationId", "facilityId", "actorId", "idempotencyKey", "projectId"]) expect(row).not.toHaveProperty(internal);
    expect(row.lines[0].tool).not.toHaveProperty("organizationId");
    expect(row.actor).not.toHaveProperty("email");
  });

  it("does not let a project-scoped admin reverse a movement of a hidden tool", async () => {
    const s = await twoDepartments();
    const hidden = await createMovement(s.f.ctx, {
      facilityId: s.f.facility.id,
      movementType: "RECEIPT", grnNumber: "GRN1",
      lines: [{ toolId: s.toolB.id, quantity: 3, destinationLocationId: s.f.locA.id }],
    });
    const admin = await createMember(s.f.org.id, `rev-${s.f.org.id}@test.local`, { role: ROLES.INVENTORY_ADMIN, facilityIds: [s.f.facility.id] });
    const ctx = { ...(await contextFor(s.f.ctx, admin)), departmentId: s.deptA.id, projectId: s.projA.id };
    await expect(reverseMovement(ctx, hidden.id)).rejects.toMatchObject({ status: 404 });
    await expect(
      createMovement(ctx, {
        facilityId: s.f.facility.id,
        movementType: "RECEIPT", grnNumber: "GRN1",
        lines: [{ toolId: s.toolB.id, quantity: 1, destinationLocationId: s.f.locA.id }],
      })
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("query parameters are validated", () => {
  it.each([
    "/api/v1/tools?page=abc",
    "/api/v1/tools?page=0",
    "/api/v1/tools?pageSize=999",
    "/api/v1/tools?sortBy=bogus",
    "/api/v1/tools?sortBy=organizationId",
    "/api/v1/tools?sortDir=sideways",
    "/api/v1/tools?stock=NOPE",
  ])("rejects %s with a 400 instead of a 500", async (url) => {
    const s = await twoDepartments();
    signIn({ userId: s.user.id, ...s.workspace });
    const res = await listTools(json(url));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("BAD_REQUEST");
  });

  it.each([
    "/api/v1/inventory/movements?page=abc",
    "/api/v1/inventory/movements?dateFrom=zzz",
    "/api/v1/inventory/movements?dateTo=2026-13-45",
    "/api/v1/inventory/movements?dateFrom=2026-02-01&dateTo=2026-01-01",
    "/api/v1/inventory/movements?movementType=BOGUS",
    "/api/v1/inventory/movements?status=BOGUS",
  ])("rejects %s with a 400", async (url) => {
    const s = await twoDepartments();
    signIn({ userId: s.user.id, ...s.workspace });
    expect((await listMovements(json(url))).status).toBe(400);
  });

  it("accepts whitelisted sorting and blank filters", async () => {
    const s = await twoDepartments();
    signIn({ userId: s.user.id, ...s.workspace });
    expect((await listTools(json("/api/v1/tools?sortBy=code&sortDir=desc&search=&status="))).status).toBe(200);
    expect((await listMovements(json("/api/v1/inventory/movements?dateFrom=2020-01-01&dateTo=2030-01-01"))).status).toBe(200);
  });
});

describe("roles", () => {
  it("lets Inventory Admins create and edit tools but not approve adjustments", () => {
    const admin = permissionsForRole(ROLES.INVENTORY_ADMIN);
    expect(admin.has("tool.create")).toBe(true);
    expect(admin.has("tool.update")).toBe(true);
    expect(admin.has("stock.adjust")).toBe(true);
    expect(admin.has("stock.adjust.approve")).toBe(false);
    expect(admin.has("movement.reverse")).toBe(true);
    expect(permissionsForRole(ROLES.SUPER_ADMIN).has("stock.adjust.approve")).toBe(true);
    const user = permissionsForRole(ROLES.USER);
    for (const p of ["movement.reverse", "tool.create", "tool.update", "stock.adjust", "movement.create"]) expect(user.has(p)).toBe(false);
  });

  it("creates a tool as an Inventory Admin inside the selected project", async () => {
    const s = await twoDepartments();
    const admin = await createMember(s.f.org.id, `maker-${s.f.org.id}@test.local`, { role: ROLES.INVENTORY_ADMIN, facilityIds: [s.f.facility.id] });
    signIn({ userId: admin.id, ...s.workspace });
    const res = await createTool(json("/api/v1/tools", {
      method: "POST",
      body: JSON.stringify({ code: `NEW-${s.f.org.id}`, name: "New tool", minimumQuantity: 1, totalStockCapacity: 5, storageLocationId: s.f.locA.id }),
    }));
    expect(res.status).toBe(201);
    const created = (await res.json()).data;
    expect(created).not.toHaveProperty("organizationId");
    expect((await prisma.tool.findUniqueOrThrow({ where: { id: created.id } })).projectId).toBe(s.projA.id);
  });

  it("gives adjustment approval a real second person", async () => {
    const s = await twoDepartments();
    const admin = await createMember(s.f.org.id, `req-${s.f.org.id}@test.local`, { role: ROLES.INVENTORY_ADMIN, facilityIds: [s.f.facility.id] });
    const adminCtx = await contextFor(s.f.ctx, admin);
    await createMovement(s.f.ctx, {
      facilityId: s.f.facility.id, movementType: "RECEIPT", grnNumber: "GRN1",
      lines: [{ toolId: s.toolA.id, quantity: 10, destinationLocationId: s.f.locA.id }],
    });
    const request = await createMovement(adminCtx, {
      facilityId: s.f.facility.id, movementType: "ADJUSTMENT", reason: "Count",
      lines: [{ toolId: s.toolA.id, quantity: 2, destinationLocationId: s.f.locA.id, adjustmentDirection: "DECREASE" }],
    });
    expect(request.status).toBe("PENDING_APPROVAL");
    await expect(approveMovement(adminCtx, request.id)).rejects.toMatchObject({ status: 403 });
    expect((await approveMovement(s.f.ctx, request.id)).status).toBe("POSTED");
  });
});

async function accountWithPassword(label: string) {
  const f = await createFixture();
  const user = await createMember(f.org.id, `${label}-${f.org.id}@test.local`.toLowerCase());
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
  return { f, user };
}

const attempt = (email: string, password: string, ip = "10.0.0.1") =>
  loginRoute(json("/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ email, password }),
  }));

describe("login hardening", () => {
  it("signs in with the right password and sets a session cookie", async () => {
    const { user } = await accountWithPassword("ok");
    const res = await attempt(user.email, PASSWORD);
    expect(res.status).toBe(200);
    expect(res.cookies.get(SESSION_COOKIE_NAME)?.value).toBeTruthy();
  });

  it("locks the account after repeated failures, even for the right password", async () => {
    const { user } = await accountWithPassword("lock");
    for (let i = 0; i < 5; i++) expect((await attempt(user.email, "wrong-password")).status).toBe(401);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).lockedUntil).not.toBeNull();
    const blocked = await attempt(user.email, PASSWORD);
    expect(blocked.status).toBe(401);
    expect((await blocked.json()).error.message).toBe("Invalid email or password.");

    await prisma.user.update({ where: { id: user.id }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    expect((await attempt(user.email, PASSWORD)).status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).failedLoginCount).toBe(0);
  });

  it("rate limits repeated attempts for one email with Retry-After", async () => {
    let last: Response | undefined;
    for (let i = 0; i < 11; i++) last = await attempt("nobody@test.local", "x", `10.0.1.${i}`);
    expect(last!.status).toBe(429);
    expect(Number(last!.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("runs bcrypt and answers identically for unknown emails", async () => {
    const { user } = await accountWithPassword("known");
    const compare = vi.spyOn(bcrypt, "compare");
    const unknown = await attempt("ghost@test.local", "whatever");
    const wrong = await attempt(user.email, "whatever");
    expect(compare).toHaveBeenCalledTimes(2);
    expect(unknown.status).toBe(401);
    expect((await unknown.json()).error.message).toBe((await wrong.json()).error.message);
  });
});

describe("session revocation", () => {
  it("ends existing sessions when a password is reset or the account is deactivated", async () => {
    const { f, user } = await accountWithPassword("revoke");
    signIn({ userId: user.id, tv: 0, organizationId: f.org.id });
    expect((await sessionRoute()).status).toBe(200);

    await updateUser(f.ctx, user.id, { password: "An0therSecret!" });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).tokenVersion).toBe(1);
    expect((await sessionRoute()).status).toBe(401);

    signIn({ userId: user.id, tv: 1, organizationId: f.org.id });
    expect((await sessionRoute()).status).toBe(200);
    await updateUser(f.ctx, user.id, { status: "INACTIVE" });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).tokenVersion).toBe(2);
    expect((await sessionRoute()).status).toBe(401);
  });
});

describe("JWT secret", () => {
  it("refuses weak or placeholder secrets in production but allows a strong one", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("JWT_SECRET", "short-secret-1234567");
    expect(() => signSession({ userId: "u" })).toThrow(/at least 32/);
    vi.stubEnv("JWT_SECRET", "replace-with-a-long-random-secret-xxxxxxxx");
    expect(() => signSession({ userId: "u" })).toThrow(/placeholder/);
    vi.stubEnv("JWT_SECRET", "abababababababababababababababab");
    expect(() => signSession({ userId: "u" })).toThrow(/low-entropy/);
    // A random secret that merely contains the word "secret" is not a placeholder.
    vi.stubEnv("JWT_SECRET", "tims-dev-secret-Qm2vLr8TnW4kZc7BfH1sDj");
    expect(() => signSession({ userId: "u" })).not.toThrow();
    vi.stubEnv("JWT_SECRET", "x9Qm2vLr8TnW4kZc7BfH1sDj6GaP3yUe0Ni5");
    expect(() => signSession({ userId: "u" })).not.toThrow();
    vi.unstubAllEnvs();
  });
});

describe("password reset", () => {
  const sentToken = () => {
    const call = vi.mocked(sendMail).mock.calls.at(-1)?.[0];
    return call?.text.match(/token=([\w-]+)/)?.[1] ?? "";
  };

  it("issues a single-use token, replaces the password and signs everyone out", async () => {
    const { user } = await accountWithPassword("reset");
    vi.mocked(sendMail).mockClear();
    await requestPasswordReset(user.email, "http://localhost:3000");
    const token = sentToken();
    expect(token.length).toBeGreaterThan(20);
    const stored = await prisma.passwordResetToken.findFirstOrThrow({ where: { userId: user.id } });
    expect(stored.tokenHash).not.toContain(token);

    await resetPasswordWithToken(token, "Brand-new-pass1");
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.tokenVersion).toBe(1);
    expect(await bcrypt.compare("Brand-new-pass1", after.passwordHash)).toBe(true);
    await expect(resetPasswordWithToken(token, "Another-pass-22")).rejects.toMatchObject({ status: 400 });
  });

  it("rejects expired tokens and stays silent for unknown emails", async () => {
    const { user } = await accountWithPassword("expire");
    vi.mocked(sendMail).mockClear();
    await requestPasswordReset(user.email, "http://localhost:3000");
    const token = sentToken();
    await prisma.passwordResetToken.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(resetPasswordWithToken(token, "Brand-new-pass1")).rejects.toMatchObject({ status: 400 });

    vi.mocked(sendMail).mockClear();
    await expect(requestPasswordReset("nobody-here@test.local", "http://localhost:3000")).resolves.toBeUndefined();
    expect(sendMail).not.toHaveBeenCalled();
  });
});
