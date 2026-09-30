import {
  applyMembershipEvent,
  replayMembership,
} from "./core.ts";
import {
  MembershipAdminConflictError,
  MembershipAlreadyExistsError,
  MembershipNotFoundError,
} from "./errors.ts";
import type {
  AppendMembershipEventInput,
  ManagedTenantMembership,
  MembershipAdminEvent,
  MembershipAdminRepository,
  StoredManagedMembership,
} from "./types.ts";

interface RecordValue {
  membership: ManagedTenantMembership;
  events: MembershipAdminEvent[];
}

function key(
  tenantId: string,
  principalId: string,
): string {
  return `${tenantId}\u0000${principalId}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryMembershipAdminRepository
implements MembershipAdminRepository {
  private readonly records = new Map<
    string,
    RecordValue
  >();

  private actorInUse(
    tenantId: string,
    actorId: string,
    exceptPrincipalId?: string,
  ): boolean {
    for (const record of this.records.values()) {
      if (
        record.membership.tenantId === tenantId &&
        record.membership.actorId === actorId &&
        record.membership.principalId !==
          exceptPrincipalId
      ) {
        return true;
      }
    }

    return false;
  }

  async load(
    tenantId: string,
    principalId: string,
  ): Promise<StoredManagedMembership | null> {
    const record = this.records.get(
      key(tenantId, principalId),
    );

    if (!record) return null;

    return {
      membership: clone(record.membership),
      events: clone(record.events),
    };
  }

  async create(
    event: Extract<
      MembershipAdminEvent,
      { type: "membership_created" }
    >,
  ): Promise<ManagedTenantMembership> {
    const storageKey = key(
      event.tenantId,
      event.principalId,
    );

    if (this.records.has(storageKey)) {
      throw new MembershipAlreadyExistsError(
        event.tenantId,
        event.principalId,
      );
    }

    if (
      this.actorInUse(
        event.tenantId,
        event.data.actorId,
      )
    ) {
      throw new MembershipAlreadyExistsError(
        event.tenantId,
        event.principalId,
      );
    }

    const membership = replayMembership([event]);
    this.records.set(storageKey, {
      membership: clone(membership),
      events: [clone(event)],
    });

    return clone(membership);
  }

  async append(
    input: AppendMembershipEventInput,
  ): Promise<ManagedTenantMembership> {
    const storageKey = key(
      input.tenantId,
      input.principalId,
    );
    const record = this.records.get(storageKey);

    if (!record) {
      throw new MembershipNotFoundError(
        input.tenantId,
        input.principalId,
      );
    }

    if (
      record.membership.version !==
      input.expectedVersion
    ) {
      throw new MembershipAdminConflictError(
        input.expectedVersion,
        record.membership.version,
      );
    }

    if (
      input.event.type === "actor_id_changed" &&
      this.actorInUse(
        input.tenantId,
        input.event.data.actorId,
        input.principalId,
      )
    ) {
      throw new MembershipAlreadyExistsError(
        input.tenantId,
        input.principalId,
      );
    }

    const membership = applyMembershipEvent(
      record.membership,
      input.event,
    );

    const events = [
      ...record.events,
      clone(input.event),
    ];

    this.records.set(storageKey, {
      membership: clone(membership),
      events,
    });

    return clone(membership);
  }
}
