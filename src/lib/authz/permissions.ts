export const PERMISSIONS = {
  ORG_READ: "organization.read",
  ORG_MANAGE: "organization.manage",

  FACILITY_READ: "facility.read",
  FACILITY_MANAGE: "facility.manage",

  DEPARTMENT_READ: "department.read",
  DEPARTMENT_MANAGE: "department.manage",

  PROJECT_READ: "project.read",
  PROJECT_CREATE: "project.create",
  PROJECT_UPDATE: "project.update",
  PROJECT_ARCHIVE: "project.archive",

  TOOL_READ: "tool.read",
  TOOL_CREATE: "tool.create",
  TOOL_UPDATE: "tool.update",
  TOOL_DEACTIVATE: "tool.deactivate",
  TOOL_DELETE: "tool.delete",

  INVENTORY_SUMMARY_READ: "inventory.summary.read",

  STOCK_READ: "stock.read",
  STOCK_ISSUE: "stock.issue",
  STOCK_RECEIVE: "stock.receive",
  STOCK_RETURN: "stock.return",
  STOCK_TRANSFER: "stock.transfer",
  STOCK_ADJUST: "stock.adjust",
  STOCK_ADJUST_APPROVE: "stock.adjust.approve",

  MOVEMENT_READ: "movement.read",
  MOVEMENT_CREATE: "movement.create",
  MOVEMENT_REVERSE: "movement.reverse",

  MACHINE_READ: "machine.read",
  MACHINE_MANAGE: "machine.manage",

  USER_READ: "user.read",
  USER_MANAGE: "user.manage",

  SETTINGS_READ: "settings.read",
  SETTINGS_MANAGE: "settings.manage",
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSION_CODES: string[] = Object.values(PERMISSIONS);



// The application has exactly three roles; permissions are fixed in code, not configurable at runtime.
export const ROLES = {
  SUPER_ADMIN: "SUPER_ADMIN",
  INVENTORY_ADMIN: "INVENTORY_ADMIN",
  USER: "USER",
} as const;

export type RoleCode = (typeof ROLES)[keyof typeof ROLES];

export const ROLE_CODES: RoleCode[] = Object.values(ROLES);

export const ROLE_LABELS: Record<RoleCode, string> = {
  SUPER_ADMIN: "Super Admin",
  INVENTORY_ADMIN: "Inventory Admin",
  USER: "User",
};

export function isRoleCode(value: unknown): value is RoleCode {
  return typeof value === "string" && (ROLE_CODES as string[]).includes(value);
}

const READ_ONLY_PERMISSIONS: string[] = [
  PERMISSIONS.FACILITY_READ,
  PERMISSIONS.DEPARTMENT_READ,
  PERMISSIONS.PROJECT_READ,
  PERMISSIONS.TOOL_READ,
  PERMISSIONS.INVENTORY_SUMMARY_READ,
  PERMISSIONS.STOCK_READ,
  PERMISSIONS.MOVEMENT_READ,
  PERMISSIONS.MACHINE_READ,
];

// Facility/department/project scope is enforced separately (see authz/authorize.ts).
export const ROLE_PERMISSIONS: Record<RoleCode, string[]> = {
  SUPER_ADMIN: ALL_PERMISSION_CODES,
  INVENTORY_ADMIN: [
    ...READ_ONLY_PERMISSIONS,
    PERMISSIONS.PROJECT_CREATE,
    PERMISSIONS.PROJECT_UPDATE,
    PERMISSIONS.PROJECT_ARCHIVE,
    PERMISSIONS.TOOL_CREATE,
    PERMISSIONS.TOOL_UPDATE,
    PERMISSIONS.TOOL_DELETE,
    PERMISSIONS.USER_READ,
    PERMISSIONS.USER_MANAGE,
    PERMISSIONS.STOCK_ISSUE,
    PERMISSIONS.STOCK_RECEIVE,
    PERMISSIONS.STOCK_RETURN,
    PERMISSIONS.STOCK_TRANSFER,
    // Inventory Admins request adjustments; only a Super Admin holds stock.adjust.approve,
    // so every Inventory Admin adjustment goes through a genuine second-person approval.
    PERMISSIONS.STOCK_ADJUST,
    PERMISSIONS.MOVEMENT_CREATE,
    PERMISSIONS.MOVEMENT_REVERSE,
  ],
  USER: READ_ONLY_PERMISSIONS,
};

// Unknown roles resolve to no permissions (fail closed).
export function permissionsForRole(role: string): Set<string> {
  return new Set(isRoleCode(role) ? ROLE_PERMISSIONS[role] : []);
}
