import {
  validateSlaPolicy,
  type CaseSlaPolicy,
} from "./sla.ts";

export interface TenantSlaPolicyDirectory {
  findByTenant(tenantId: string): Promise<CaseSlaPolicy | null>;
}

function clonePolicy(policy: CaseSlaPolicy): CaseSlaPolicy {
  return structuredClone(policy);
}

export class InMemoryTenantSlaPolicyDirectory
implements TenantSlaPolicyDirectory {
  private readonly policies = new Map<string, CaseSlaPolicy>();

  constructor(entries: Readonly<Record<string, CaseSlaPolicy>>) {
    for (const [tenantId, policy] of Object.entries(entries)) {
      validateSlaPolicy(policy);
      this.policies.set(tenantId, clonePolicy(policy));
    }
  }

  async findByTenant(
    tenantId: string,
  ): Promise<CaseSlaPolicy | null> {
    const policy = this.policies.get(tenantId);
    return policy ? clonePolicy(policy) : null;
  }
}

export class TenantSlaPolicyNotFoundError extends Error {
  readonly code = "TENANT_SLA_POLICY_NOT_FOUND";

  constructor(tenantId: string) {
    super(`Tenant SLA policy not found: ${tenantId}`);
    this.name = "TenantSlaPolicyNotFoundError";
  }
}
