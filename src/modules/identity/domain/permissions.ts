import { assertOrganizationAccess, AuthorizationError, type OrganizationPrincipal, type OrganizationRole } from './policies.js';

export const PERMISSIONS = [
  'organization:read', 'organization:update', 'organization:delete',
  'membership:read', 'membership:invite', 'membership:change', 'membership:manage-owner',
  'project:read', 'project:create', 'project:update', 'project:archive',
  'task:read', 'task:create', 'task:update-any', 'task:update-assigned', 'task:soft-delete',
  'dependency:read', 'dependency:manage',
  'assignment:read-own', 'assignment:read-all', 'assignment:manage',
  'schedule:run', 'analytics:read',
] as const;

export type Permission = typeof PERMISSIONS[number];

const PERMISSIONS_BY_ROLE: Readonly<Record<OrganizationRole, ReadonlySet<Permission>>> = {
  OWNER: new Set([
    'organization:read', 'organization:update', 'organization:delete',
    'membership:read', 'membership:invite', 'membership:change', 'membership:manage-owner',
    'project:read', 'project:create', 'project:update', 'project:archive',
    'task:read', 'task:create', 'task:update-any', 'task:update-assigned', 'task:soft-delete',
    'dependency:read', 'dependency:manage',
    'assignment:read-own', 'assignment:read-all', 'assignment:manage',
    'schedule:run', 'analytics:read',
  ]),
  ADMIN: new Set([
    'organization:read', 'organization:update',
    'membership:read', 'membership:invite', 'membership:change',
    'project:read', 'project:create', 'project:update', 'project:archive',
    'task:read', 'task:create', 'task:update-any', 'task:update-assigned', 'task:soft-delete',
    'dependency:read', 'dependency:manage',
    'assignment:read-own', 'assignment:read-all', 'assignment:manage',
    'schedule:run', 'analytics:read',
  ]),
  MEMBER: new Set([
    'organization:read', 'membership:read', 'project:read', 'task:read', 'task:create',
    'task:update-assigned', 'dependency:read', 'assignment:read-own', 'schedule:run', 'analytics:read',
  ]),
};

/** Each role receives an explicit permission set; no runtime role inheritance. */
export function hasPermission(role: OrganizationRole, permission: Permission): boolean {
  return PERMISSIONS_BY_ROLE[role].has(permission);
}

export function assertPermission(
  principal: OrganizationPrincipal,
  organizationId: string,
  permission: Permission,
): void {
  assertOrganizationAccess(principal, organizationId);
  if (!hasPermission(principal.role, permission)) throw new AuthorizationError('ROLE_FORBIDDEN');
}
