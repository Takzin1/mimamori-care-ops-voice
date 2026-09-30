import type { StaffRole } from "../access/types.ts";

export interface ManagedTenantMembership {
  tenantId: string;
  principalId: string;
  actorId: string;
  roles: StaffRole[];
  active: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

interface MembershipAdminEventBase {
  tenantId: string;
  principalId: string;
  version: number;
  at: string;
  adminActorId: string;
  reason: string;
}

export type MembershipAdminEvent =
  | (MembershipAdminEventBase & {
      type: "membership_created";
      data: {
        actorId: string;
        roles: StaffRole[];
        active: boolean;
      };
    })
  | (MembershipAdminEventBase & {
      type: "roles_replaced";
      data: {
        previousRoles: StaffRole[];
        roles: StaffRole[];
      };
    })
  | (MembershipAdminEventBase & {
      type: "membership_activated";
      data: Record<string, never>;
    })
  | (MembershipAdminEventBase & {
      type: "membership_deactivated";
      data: Record<string, never>;
    })
  | (MembershipAdminEventBase & {
      type: "actor_id_changed";
      data: {
        previousActorId: string;
        actorId: string;
      };
    });

export interface CreateMembershipInput {
  tenantId: string;
  principalId: string;
  actorId: string;
  roles: readonly StaffRole[];
  active?: boolean;
  adminActorId: string;
  reason: string;
}

export type MembershipAdminCommand =
  | {
      type: "replace_roles";
      roles: readonly StaffRole[];
      adminActorId: string;
      reason: string;
    }
  | {
      type: "activate";
      adminActorId: string;
      reason: string;
    }
  | {
      type: "deactivate";
      adminActorId: string;
      reason: string;
    }
  | {
      type: "change_actor_id";
      actorId: string;
      adminActorId: string;
      reason: string;
    };

export interface StoredManagedMembership {
  membership: ManagedTenantMembership;
  events: readonly MembershipAdminEvent[];
}

export interface AppendMembershipEventInput {
  tenantId: string;
  principalId: string;
  expectedVersion: number;
  event: MembershipAdminEvent;
}

export interface MembershipAdminRepository {
  load(
    tenantId: string,
    principalId: string,
  ): Promise<StoredManagedMembership | null>;

  create(
    event: Extract<
      MembershipAdminEvent,
      { type: "membership_created" }
    >,
  ): Promise<ManagedTenantMembership>;

  append(
    input: AppendMembershipEventInput,
  ): Promise<ManagedTenantMembership>;
}
