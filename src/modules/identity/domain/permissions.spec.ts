import { describe, expect, it } from 'vitest';
import { assertPermission, hasPermission, type Permission } from './permissions.js';
import type { OrganizationPrincipal } from './policies.js';

const allPermissions: readonly Permission[] = [
  'organization:read', 'organization:update', 'organization:delete',
  'membership:read', 'membership:invite', 'membership:change', 'membership:manage-owner',
  'project:read', 'project:create', 'project:update', 'project:archive',
  'task:read', 'task:create', 'task:update-any', 'task:update-assigned', 'task:soft-delete',
  'dependency:read', 'dependency:manage', 'assignment:read-own', 'assignment:read-all',
  'assignment:manage', 'schedule:run', 'analytics:read',
];

const roleExpectations: Record<'OWNER' | 'ADMIN' | 'MEMBER', readonly Permission[]> = {
  OWNER: allPermissions,
  ADMIN: allPermissions.filter((permission) => permission !== 'organization:delete' && permission !== 'membership:manage-owner'),
  MEMBER: [
    'organization:read', 'membership:read', 'project:read', 'task:read', 'task:create',
    'task:update-assigned', 'dependency:read', 'assignment:read-own', 'schedule:run', 'analytics:read',
  ],
};

describe('organization RBAC matrix', () => {
  it.each(['OWNER', 'ADMIN', 'MEMBER'] as const)('matches the explicit %s permission set', (role) => {
    for (const permission of allPermissions) {
      expect(hasPermission(role, permission)).toBe(roleExpectations[role].includes(permission));
    }
  });

  it('rejects cross-organization and inactive principals before granting permission', () => {
    const principal: OrganizationPrincipal = {
      userId: 'user', organizationId: 'org-a', membershipId: 'membership', role: 'OWNER', membershipStatus: 'ACTIVE',
    };
    expect(() => assertPermission(principal, 'org-b', 'organization:delete')).toThrow(/ORGANIZATION_SCOPE_MISMATCH/);
    expect(() => assertPermission({ ...principal, membershipStatus: 'SUSPENDED' }, 'org-a', 'organization:read'))
      .toThrow(/MEMBERSHIP_INACTIVE/);
  });
});
