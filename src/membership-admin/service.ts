import {
  createManagedMembership,
  executeMembershipCommand,
} from "./core.ts";
import {
  MembershipNotFoundError,
} from "./errors.ts";
import type {
  CreateMembershipInput,
  ManagedTenantMembership,
  MembershipAdminCommand,
  MembershipAdminRepository,
  StoredManagedMembership,
} from "./types.ts";

export type MembershipAdminClock = () => string;

export class MembershipAdminService {
  private readonly repository: MembershipAdminRepository;
  private readonly now: MembershipAdminClock;

  constructor(
    repository: MembershipAdminRepository,
    now: MembershipAdminClock =
      () => new Date().toISOString(),
  ) {
    this.repository = repository;
    this.now = now;
  }

  async create(
    input: CreateMembershipInput,
  ): Promise<ManagedTenantMembership> {
    const created = createManagedMembership(
      input,
      this.now(),
    );
    return this.repository.create(created.event);
  }

  async execute(input: {
    tenantId: string;
    principalId: string;
    expectedVersion: number;
    command: MembershipAdminCommand;
  }): Promise<ManagedTenantMembership> {
    const stored = await this.repository.load(
      input.tenantId,
      input.principalId,
    );

    if (!stored) {
      throw new MembershipNotFoundError(
        input.tenantId,
        input.principalId,
      );
    }

    const transition = executeMembershipCommand(
      stored.membership,
      input.expectedVersion,
      input.command,
      this.now(),
    );

    return this.repository.append({
      tenantId: input.tenantId,
      principalId: input.principalId,
      expectedVersion: input.expectedVersion,
      event: transition.event,
    });
  }

  async get(
    tenantId: string,
    principalId: string,
  ): Promise<StoredManagedMembership | null> {
    return this.repository.load(
      tenantId,
      principalId,
    );
  }
}
