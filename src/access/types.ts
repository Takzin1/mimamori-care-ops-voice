export const STAFF_ROLES = [
  "dispatcher",
  "responder",
  "supervisor",
  "auditor",
] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

export interface TenantMembership {
  tenantId: string;
  principalId: string;
  actorId: string;
  roles: readonly StaffRole[];
  active: boolean;
}

export interface TenantMembershipDirectory {
  findByPrincipal(
    tenantId: string,
    principalId: string,
  ): Promise<TenantMembership | null>;

  findByActorId(
    tenantId: string,
    actorId: string,
  ): Promise<TenantMembership | null>;
}
