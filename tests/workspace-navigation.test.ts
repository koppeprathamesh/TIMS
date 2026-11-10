import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { autoSelectWorkspace, resolveWorkspace } from "@/lib/auth/workspace";
import { issueSession } from "@/lib/auth/issue-session";
import { signSession, verifySession, SESSION_COOKIE_NAME, type SessionPayload } from "@/lib/auth/session";
import { scopeOf } from "@/lib/authz/authorize";
import { GET as getSession } from "@/app/api/v1/auth/session/route";
import { POST as setContext } from "@/app/api/v1/context/route";
import { createFixture } from "./helpers";
import { contextFor, createDepartment, createFacility, createMember, createProject } from "./admin-helpers";

const auth = vi.hoisted(() => ({ token: null as string | null }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => auth.token ? { value: auth.token } : undefined }),
}));

beforeEach(() => { auth.token = null; });

function login(payload: SessionPayload) {
  auth.token = signSession(payload);
}

async function select(body: object) {
  const response = await setContext(new NextRequest("http://localhost/api/v1/context", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }));
  const token = response.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (token) auth.token = token;
  return response;
}

describe("live workspace restoration", () => {
  it("downgrades deactivated or cross-organization facilities to the first step", async () => {
    const f = await createFixture();
    const other = await createFixture();
    expect((await resolveWorkspace({ ...f.ctx, facilityId: other.facility.id })).workspaceStep).toBe("facility");
    await prisma.facility.update({ where: { id: f.facility.id }, data: { status: "INACTIVE" } });
    expect(await resolveWorkspace(f.ctx)).toMatchObject({ facility: null, department: null, project: null, workspaceStep: "facility" });
  });

  it("rechecks department ancestry and project status", async () => {
    const f = await createFixture();
    const otherFacility = await createFacility(f.org.id);
    const department = await createDepartment(otherFacility.id);
    const project = await createProject(f.org.id, department.id);
    expect((await resolveWorkspace({ ...f.ctx, departmentId: department.id, projectId: project.id })).workspaceStep).toBe("department");
    const mine = await createDepartment(f.facility.id);
    const ownProject = await createProject(f.org.id, mine.id);
    await prisma.project.update({ where: { id: ownProject.id }, data: { status: "ARCHIVED" } });
    expect(await resolveWorkspace({ ...f.ctx, departmentId: mine.id, projectId: ownProject.id }))
      .toMatchObject({ department: { id: mine.id }, project: null, workspaceStep: "project" });
  });

  it("rechecks grants revoked since the cookie was issued", async () => {
    const f = await createFixture();
    const dept = await createDepartment(f.facility.id);
    const user = await createMember(f.org.id, `nav-${f.org.id}@test.local`, { departmentIds: [dept.id] });
    const current = await contextFor({ ...f.ctx, departmentId: dept.id }, user);
    expect((await resolveWorkspace(current)).facility?.id).toBe(f.facility.id);
    await prisma.userDepartmentAccess.deleteMany({ where: { userId: user.id } });
    expect(await resolveWorkspace(await contextFor(current, user)))
      .toMatchObject({ facility: null, department: null, workspaceStep: "facility" });
  });

  it("is only ready when facility, department and project are all valid", async () => {
    const f = await createFixture();
    expect((await resolveWorkspace(f.ctx)).workspaceStep).toBe("department");
    const dept = await createDepartment(f.facility.id);
    const project = await createProject(f.org.id, dept.id);
    expect((await resolveWorkspace({ ...f.ctx, departmentId: dept.id })).workspaceStep).toBe("project");
    expect((await resolveWorkspace({ ...f.ctx, departmentId: dept.id, projectId: project.id })).workspaceStep).toBe("ready");
  });
});

describe("automatic workspace selection", () => {
  it("chooses every level that has exactly one option", async () => {
    const f = await createFixture();
    const dept = await createDepartment(f.facility.id);
    const project = await createProject(f.org.id, dept.id);
    expect(await autoSelectWorkspace(f.org.id, scopeOf(f.ctx))).toEqual({
      facilityId: f.facility.id, departmentId: dept.id, projectId: project.id,
    });
  });

  it("stops at the first level that needs a decision", async () => {
    const f = await createFixture();
    await createDepartment(f.facility.id);
    await createDepartment(f.facility.id);
    expect(await autoSelectWorkspace(f.org.id, scopeOf(f.ctx))).toEqual({
      facilityId: f.facility.id, departmentId: null, projectId: null,
    });
  });

  it("keeps a preferred choice that is still valid and drops one that is not", async () => {
    const f = await createFixture();
    const a = await createDepartment(f.facility.id);
    const b = await createDepartment(f.facility.id);
    const project = await createProject(f.org.id, a.id);
    await createProject(f.org.id, a.id);
    expect(await autoSelectWorkspace(f.org.id, scopeOf(f.ctx), { facilityId: f.facility.id, departmentId: a.id, projectId: project.id }))
      .toMatchObject({ departmentId: a.id, projectId: project.id });
    const archived = await createDepartment(f.facility.id);
    await prisma.department.update({ where: { id: archived.id }, data: { status: "INACTIVE" } });
    expect((await autoSelectWorkspace(f.org.id, scopeOf(f.ctx), { facilityId: f.facility.id, departmentId: archived.id })).departmentId).toBeNull();
    expect(b.id).toBeTruthy();
  });

  it("only considers options inside the user's grants", async () => {
    const f = await createFixture();
    const mine = await createDepartment(f.facility.id);
    await createDepartment(f.facility.id);
    const user = await createMember(f.org.id, `auto-${f.org.id}@test.local`, { departmentIds: [mine.id] });
    const ctx = await contextFor(f.ctx, user);
    expect(await autoSelectWorkspace(f.org.id, scopeOf(ctx))).toMatchObject({ facilityId: f.facility.id, departmentId: mine.id });
  });

  it("restores the remembered workspace when a session is issued", async () => {
    const f = await createFixture();
    const a = await createDepartment(f.facility.id);
    await createDepartment(f.facility.id);
    const project = await createProject(f.org.id, a.id);
    await createProject(f.org.id, a.id);
    await prisma.user.update({
      where: { id: f.user.id },
      data: { lastFacilityId: f.facility.id, lastDepartmentId: a.id, lastProjectId: project.id },
    });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } });
    expect(verifySession(await issueSession(user, f.org.id))).toMatchObject({
      userId: f.user.id, facilityId: f.facility.id, departmentId: a.id, projectId: project.id,
    });
  });
});

describe("context selection API", () => {
  it("rejects empty selections and later levels without a valid facility", async () => {
    const f = await createFixture();
    const dept = await createDepartment(f.facility.id);
    login({ userId: f.user.id, organizationId: f.org.id });
    expect((await select({})).status).toBe(400);
    expect((await select({ departmentId: dept.id })).status).toBe(400);
    expect((await select({ projectId: "anything" })).status).toBe(400);
  });

  it("auto-selects single options, remembers the workspace and resets lower levels", async () => {
    const f = await createFixture();
    const a = await createDepartment(f.facility.id);
    const b = await createDepartment(f.facility.id);
    const project = await createProject(f.org.id, a.id);
    login({ userId: f.user.id, organizationId: f.org.id });

    const first = await select({ facilityId: f.facility.id });
    expect(first.status).toBe(200);
    expect((await first.json()).workspaceStep).toBe("department");
    expect(verifySession(auth.token!)?.departmentId).toBeUndefined();

    const second = await select({ departmentId: a.id });
    expect((await second.json())).toMatchObject({ departmentId: a.id, projectId: project.id, workspaceStep: "ready" });
    expect(verifySession(auth.token!)).toMatchObject({ facilityId: f.facility.id, departmentId: a.id, projectId: project.id });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } })).toMatchObject({
      lastFacilityId: f.facility.id, lastDepartmentId: a.id, lastProjectId: project.id,
    });

    const third = await select({ departmentId: b.id });
    expect((await third.json())).toMatchObject({ departmentId: b.id, projectId: null, workspaceStep: "project" });
    expect((await select({ facilityId: f.facility.id })).status).toBe(200);
    expect(verifySession(auth.token!)?.departmentId).toBeUndefined();
  });

  it("selects a project on its own and derives the department", async () => {
    const f = await createFixture();
    const a = await createDepartment(f.facility.id);
    await createDepartment(f.facility.id);
    const p1 = await createProject(f.org.id, a.id);
    await createProject(f.org.id, a.id);
    login({ userId: f.user.id, organizationId: f.org.id, facilityId: f.facility.id });
    expect((await select({ projectId: p1.id })).status).toBe(200);
    expect(verifySession(auth.token!)).toMatchObject({ departmentId: a.id, projectId: p1.id });
  });

  it("rejects a department or project from a different facility", async () => {
    const f = await createFixture();
    const other = await createFacility(f.org.id);
    const dept = await createDepartment(other.id);
    const project = await createProject(f.org.id, dept.id);
    login({ userId: f.user.id, organizationId: f.org.id, facilityId: f.facility.id });
    expect((await select({ departmentId: dept.id })).status).toBe(404);
    expect((await select({ projectId: project.id })).status).toBe(400);
  });

  it("does not let a stale revoked facility cookie advance the sequence", async () => {
    const f = await createFixture();
    const dept = await createDepartment(f.facility.id);
    const user = await createMember(f.org.id, `empty-${f.org.id}@test.local`);
    login({ userId: user.id, organizationId: f.org.id, facilityId: f.facility.id });
    expect((await select({ departmentId: dept.id })).status).toBe(400);
  });
});

describe("navigation session endpoint", () => {
  it("returns the live role and sanitized workspace with no-store caching", async () => {
    const f = await createFixture();
    login({ userId: f.user.id, organizationId: f.org.id, facilityId: f.facility.id });
    await prisma.user.update({ where: { id: f.user.id }, data: { role: "USER" } });
    const response = await getSession();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({ role: "USER", facility: null, workspaceStep: "facility" });
  });

  it("returns 401 after sign-out rather than a cached identity", async () => {
    expect((await getSession()).status).toBe(401);
  });
});
