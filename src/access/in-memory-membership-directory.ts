import type {
  TenantMembership,
  TenantMembershipDirectory,
} from "./types.ts";

function principalKey(tenantId: string, principalId: string): string {
  return `${tenantId}\u0000principal\u0000${principalId}`;
}

function actorKey(tenantId: string, actorId: string): string {
  return `${tenantId}\u0000actor\u0000${actorId}`;
}

function cloneMembership(
  membership: TenantMembership,
): TenantMembership {
  return {
    ...structuredClone(membership),
    roles: [...membership.roles],
  };
}

export class InMemoryTenantMembershipDirectory
implements TenantMembershipDirectory {
  private readonly byPrincipal = new Map<string, TenantMembership>();
  private readonly byActor = new Map<string, TenantMembership>();

  constructor(memberships: readonly TenantMembership[]) {
    for (const membership of memberships) {
      const principal = principalKey(
        membership.tenantId,
        membership.principalId,
      );
      const actor = actorKey(
        membership.tenantId,
        membership.actorId,
      );

      if (this.byPrincipal.has(principal) || this.byActor.has(actor)) {
        throw new Error("Duplicate tenant membership identity");
      }

      const stored = cloneMembership(membership);
      this.byPrincipal.set(principal, stored);
      this.byActor.set(actor, stored);
    }
  }

  async findByPrincipal(
    tenantId: string,
    principalId: string,
  ): Promise<TenantMembership | null> {
    const membership = this.byPrincipal.get(
      principalKey(tenantId, principalId),
    );

    return membership ? cloneMembership(membership) : null;
  }

  async findByActorId(
    tenantId: string,
    actorId: string,
  ): Promise<TenantMembership | null> {
    const membership = this.byActor.get(actorKey(tenantId, actorId));

    return membership ? cloneMembership(membership) : null;
  }
}
