import {
  assertCanReadCase,
  queueVisibilityForMembership,
} from "../access/policy.ts";
import type {
  TenantMembership,
  TenantMembershipDirectory,
} from "../access/types.ts";
import {
  projectCaseQueue,
  TenantSlaPolicyNotFoundError,
  type CaseQueueProjection,
  type CaseQueueScope,
  type TenantSlaPolicyDirectory,
} from "../operations/index.ts";
import type { CaseRepository } from "../persistence/types.ts";

export interface CaseQueueRequest {
  tenantId: string;
  principalId: string;
}

export type QueueClock = () => string;

function queueScope(
  membership: TenantMembership,
): CaseQueueScope {
  return (
    queueVisibilityForMembership(
      membership,
    ) === "tenant"
  )
    ? { type: "tenant" }
    : {
        type: "responder",
        actorId: membership.actorId,
      };
}

export class CaseQueueService {
  private readonly repository: CaseRepository;
  private readonly memberships: TenantMembershipDirectory;
  private readonly policies: TenantSlaPolicyDirectory;
  private readonly now: QueueClock;

  constructor(
    repository: CaseRepository,
    memberships: TenantMembershipDirectory,
    policies: TenantSlaPolicyDirectory,
    now: QueueClock = () => new Date().toISOString(),
  ) {
    this.repository = repository;
    this.memberships = memberships;
    this.policies = policies;
    this.now = now;
  }

  async list(
    input: CaseQueueRequest,
  ): Promise<CaseQueueProjection> {
    const membership = await this.memberships.findByPrincipal(
      input.tenantId,
      input.principalId,
    );
    assertCanReadCase(membership);

    const policy = await this.policies.findByTenant(input.tenantId);
    if (!policy) {
      throw new TenantSlaPolicyNotFoundError(input.tenantId);
    }

    const storedCases = await this.repository.list(input.tenantId);

    return projectCaseQueue(
      storedCases,
      input.tenantId,
      queueScope(membership),
      policy,
      this.now(),
    );
  }
}
