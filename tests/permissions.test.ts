import { describe, expect, it } from "vitest";
import {
  ALL_PERMISSION_CODES,
  PERMISSIONS,
  ROLES,
  ROLE_CODES,
  ROLE_PERMISSIONS,
  permissionsForRole,
} from "@/lib/authz/permissions";
import {
  assertDepartmentAccess,
  assertFacilityAccess,
  assertProjectAccess,
  facilityIdFilter,
  requirePermission,
  resolveAccessScope,
  type RequestContext,
} from "@/lib/authz/authorize";
import { createFixture } from "./helpers";
import { createDepartment, createFacility, createMember, createProject } from "./admin-helpers";

function ctx(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    userId: "u1",
    organizationId: "o1",
    facilityId: "f1",
    departmentId: null,
    projectId: null,
    role: ROLES.USER,
    permissions: new Set<string>(),
    unrestricted: false,
    grantedFacilityIds: new Set<string>(),
    grantedDepartmentIds: new Set<string>(),
    grantedProjectIds: new Set<string>(),
    ...overrides,
  };
}

describe("role registry", () => {
  it("defines exactly three roles", () => {
    expect([...ROLE_CODES].sort()).toEqual(["INVENTORY_ADMIN", "SUPER_ADMIN", "USER"]);
  });

  it("has unique, dot-separated permission codes", () => {
    expect(new Set(ALL_PERMISSION_CODES).size).toBe(ALL_PERMISSION_CODES.length);
    for (const code of ALL_PERMISSION_CODES) expect(code).toMatch(/^[a-z]+(\.[a-z]+)+$/);
  });

  it("only references registered permission codes", () => {
    const known = new Set(ALL_PERMISSION_CODES);
    for (const role of ROLE_CODES) {
      for (const code of ROLE_PERMISSIONS[role]) expect(known.has(code), `${role} -> ${code}`).toBe(true);
    }
  });

  it("gives SUPER_ADMIN every permission", () => {
    expect([...ROLE_PERMISSIONS.SUPER_ADMIN].sort()).toEqual([...ALL_PERMISSION_CODES].sort());
  });

  it("limits structure management to SUPER_ADMIN", () => {
    for (const code of [PERMISSIONS.FACILITY_MANAGE, PERMISSIONS.DEPARTMENT_MANAGE, PERMISSIONS.SETTINGS_MANAGE]) {
      expect(ROLE_PERMISSIONS.INVENTORY_ADMIN).not.toContain(code);
      expect(ROLE_PERMISSIONS.USER).not.toContain(code);
    }
  });

  it("lets INVENTORY_ADMIN manage projects and users but not facilities", () => {
    for (const code of [PERMISSIONS.PROJECT_CREATE, PERMISSIONS.PROJECT_UPDATE, PERMISSIONS.PROJECT_ARCHIVE, PERMISSIONS.USER_MANAGE]) {
      expect(ROLE_PERMISSIONS.INVENTORY_ADMIN).toContain(code);
    }
  });

  it("keeps USER strictly read-only", () => {
    for (const code of ROLE_PERMISSIONS.USER) {
      expect(code, code).toMatch(/\.(read)$/);
    }
  });

  it("fails closed for unknown roles", () => {
    expect(permissionsForRole("ORG_ADMIN").size).toBe(0);
  });
});

describe("authorization guards", () => {
  it("requirePermission allows held and rejects missing permissions", () => {
    const c = ctx({ permissions: new Set([PERMISSIONS.TOOL_READ]) });
    expect(() => requirePermission(c, PERMISSIONS.TOOL_READ)).not.toThrow();
    expect(() => requirePermission(c, PERMISSIONS.TOOL_CREATE)).toThrowError(/Missing required permission/);
  });

  it("lets unrestricted contexts reach any facility, department and project", () => {
    const c = ctx({ unrestricted: true });
    expect(() => assertFacilityAccess(c, "any")).not.toThrow();
    expect(() => assertDepartmentAccess(c, "any")).not.toThrow();
    expect(() => assertProjectAccess(c, "any")).not.toThrow();
    expect(facilityIdFilter(c)).toBeUndefined();
  });

  it("denies everything to a scoped context with no grants", () => {
    const c = ctx();
    expect(() => assertFacilityAccess(c, "f1")).toThrowError(/plant/i);
    expect(() => assertDepartmentAccess(c, "d1")).toThrowError(/project/i);
    expect(() => assertProjectAccess(c, "p1")).toThrowError(/part/i);
    expect(facilityIdFilter(c)).toEqual({ in: [] });
  });

  it("restricts access to the granted ids", () => {
    const c = ctx({
      grantedFacilityIds: new Set(["f1"]),
      grantedDepartmentIds: new Set(["d1"]),
      grantedProjectIds: new Set(["p1"]),
    });
    expect(() => assertFacilityAccess(c, "f1")).not.toThrow();
    expect(() => assertFacilityAccess(c, "f2")).toThrowError(/plant/i);
    expect(() => assertDepartmentAccess(c, "d1")).not.toThrow();
    expect(() => assertDepartmentAccess(c, "d2")).toThrowError(/project/i);
    expect(() => assertProjectAccess(c, "p1")).not.toThrow();
    expect(() => assertProjectAccess(c, "p2")).toThrowError(/part/i);
    expect(() => assertProjectAccess(c, null)).not.toThrow();
  });
});

describe("access scope resolution", () => {
  it("is unrestricted for a Super Admin", async () => {
    const f = await createFixture();
    const scope = await resolveAccessScope(f.user.id, ROLES.SUPER_ADMIN, f.org.id);
    expect(scope.unrestricted).toBe(true);
  });

  it("derives an Inventory Admin's departments and projects from facility grants", async () => {
    const f = await createFixture();
    const other = await createFacility(f.org.id);
    const dept = await createDepartment(f.facility.id);
    const otherDept = await createDepartment(other.id);
    const project = await createProject(f.org.id, dept.id);
    const otherProject = await createProject(f.org.id, otherDept.id);
    const admin = await createMember(f.org.id, `ia-${f.org.id}@t.local`, {
      role: ROLES.INVENTORY_ADMIN,
      facilityIds: [f.facility.id],
    });

    const scope = await resolveAccessScope(admin.id, ROLES.INVENTORY_ADMIN, f.org.id);
    expect(scope.unrestricted).toBe(false);
    expect([...scope.facilityIds]).toEqual([f.facility.id]);
    expect([...scope.departmentIds]).toEqual([dept.id]);
    expect(scope.projectIds.has(project.id)).toBe(true);
    expect(scope.projectIds.has(otherProject.id)).toBe(false);
  });

  it("limits a User to the departments they were granted", async () => {
    const f = await createFixture();
    const granted = await createDepartment(f.facility.id);
    const notGranted = await createDepartment(f.facility.id);
    const project = await createProject(f.org.id, granted.id);
    const hidden = await createProject(f.org.id, notGranted.id);
    const user = await createMember(f.org.id, `u-${f.org.id}@t.local`, { departmentIds: [granted.id] });

    const scope = await resolveAccessScope(user.id, ROLES.USER, f.org.id);
    expect([...scope.departmentIds]).toEqual([granted.id]);
    expect([...scope.facilityIds]).toEqual([f.facility.id]);
    expect(scope.projectIds.has(project.id)).toBe(true);
    expect(scope.projectIds.has(hidden.id)).toBe(false);
  });

  it("gives a User with no grants no access", async () => {
    const f = await createFixture();
    const user = await createMember(f.org.id, `n-${f.org.id}@t.local`);
    const scope = await resolveAccessScope(user.id, ROLES.USER, f.org.id);
    expect(scope.facilityIds.size + scope.departmentIds.size + scope.projectIds.size).toBe(0);
  });
});
