import {
  calculateCaseMetrics,
  createCase,
  executeCommand,
} from "../core/index.ts";
import type {
  CaseAggregate,
  CaseCommand,
  CaseMetrics,
} from "../core/index.ts";
import {
  assertActiveMembership,
  assertAssignableTarget,
  assertCanExecuteCommand,
  assertCanReadCase,
  assertCanReadCaseAggregate,
} from "../access/policy.ts";
import type {
  TenantMembership,
  TenantMembershipDirectory,
} from "../access/types.ts";
import {
  CaseNotFoundError,
} from "../persistence/errors.ts";
import type {
  CaseRepository,
  StoredCase,
} from "../persistence/types.ts";
import {
  projectCaseCapabilities,
  projectOperatorContext,
  type CaseCapabilitiesProjection,
  type OperatorContextProjection,
} from "./capabilities.ts";
import type {
  AttentionSignal,
  CaseCommandIntent,
  CaseOpenResult,
  CaseOperationResult,
  CaseQueryInput,
  ExecuteCaseCommandInput,
} from "./types.ts";

export type Clock = () => string;

function bindActor(
  command: CaseCommandIntent,
  actorId: string,
): CaseCommand {
  switch (command.type) {
    case "set_priority":
      return {
        type: "set_priority",
        actorId,
        priority: command.priority,
      };
    case "acknowledge":
      return { type: "acknowledge", actorId };
    case "assign":
      return {
        type: "assign",
        actorId,
        assigneeId: command.assigneeId,
      };
    case "start_action":
      return { type: "start_action", actorId };
    case "request_handoff":
      return {
        type: "request_handoff",
        actorId,
        targetAssigneeId: command.targetAssigneeId,
      };
    case "accept_handoff":
      return { type: "accept_handoff", actorId };
    case "complete":
      return {
        type: "complete",
        actorId,
        outcome: command.outcome,
        summary: command.summary,
        evidence: command.evidence,
      };
    case "close":
      return { type: "close", actorId };
    case "reopen":
      return {
        type: "reopen",
        actorId,
        reason: command.reason,
      };
  }
}

export class CaseService {
  private readonly repository: CaseRepository;
  private readonly memberships: TenantMembershipDirectory;
  private readonly now: Clock;

  constructor(
    repository: CaseRepository,
    memberships: TenantMembershipDirectory,
    now: Clock = () => new Date().toISOString(),
  ) {
    this.repository = repository;
    this.memberships = memberships;
    this.now = now;
  }

  async openFromSignal(
    signal: AttentionSignal,
    caseId: string,
  ): Promise<CaseOpenResult> {
    const created = createCase({
      id: caseId,
      tenantId: signal.tenantId,
      subjectId: signal.subjectId,
      sourceType: signal.type,
      sourceAdapter: signal.sourceAdapter,
      sourceSignalId: signal.id,
      priority: signal.priority,
      ...(signal.sourceEvidence ? { sourceEvidence: signal.sourceEvidence } : {}),
      createdAt: this.now(),
    });

    const stored = await this.repository.create(created.event);

    return {
      aggregate: stored.aggregate,
      event: stored.event,
      created: stored.created,
    };
  }

  private async membershipFor(
    tenantId: string,
    principalId: string,
  ): Promise<TenantMembership | null> {
    return this.memberships.findByPrincipal(tenantId, principalId);
  }

  private async assertTargetAssignable(
    tenantId: string,
    actorId: string,
  ): Promise<void> {
    const target = await this.memberships.findByActorId(
      tenantId,
      actorId,
    );
    assertAssignableTarget(target);
  }

  async execute(
    input: ExecuteCaseCommandInput,
  ): Promise<CaseOperationResult> {
    const membership = await this.membershipFor(
      input.tenantId,
      input.principalId,
    );
    assertCanExecuteCommand(membership, input.command);

    if (input.command.type === "assign") {
      await this.assertTargetAssignable(
        input.tenantId,
        input.command.assigneeId,
      );
    }

    if (input.command.type === "request_handoff") {
      await this.assertTargetAssignable(
        input.tenantId,
        input.command.targetAssigneeId,
      );
    }

    const stored = await this.repository.load(
      input.tenantId,
      input.caseId,
    );

    if (!stored) {
      throw new CaseNotFoundError(input.tenantId, input.caseId);
    }

    assertCanReadCaseAggregate(
      membership,
      stored.aggregate,
    );

    const transition = executeCommand(
      stored.aggregate,
      input.expectedVersion,
      bindActor(input.command, membership.actorId),
      this.now(),
    );

    const aggregate = await this.repository.append({
      tenantId: input.tenantId,
      caseId: input.caseId,
      expectedVersion: input.expectedVersion,
      event: transition.event,
    });

    return {
      aggregate,
      event: transition.event,
    };
  }

  async operatorContext(input: {
    tenantId: string;
    principalId: string;
  }): Promise<OperatorContextProjection> {
    const membership = await this.membershipFor(
      input.tenantId,
      input.principalId,
    );
    assertActiveMembership(membership);

    return projectOperatorContext(
      membership,
    );
  }

  async capabilities(
    input: CaseQueryInput,
  ): Promise<CaseCapabilitiesProjection> {
    const membership = await this.membershipFor(
      input.tenantId,
      input.principalId,
    );
    assertCanReadCase(membership);

    const stored = await this.repository.load(
      input.tenantId,
      input.caseId,
    );

    if (!stored) {
      throw new CaseNotFoundError(
        input.tenantId,
        input.caseId,
      );
    }

    assertCanReadCaseAggregate(
      membership,
      stored.aggregate,
    );

    return projectCaseCapabilities(
      stored.aggregate,
      membership,
    );
  }

  async get(input: CaseQueryInput): Promise<StoredCase | null> {
    const membership = await this.membershipFor(
      input.tenantId,
      input.principalId,
    );
    assertCanReadCase(membership);

    const stored = await this.repository.load(
      input.tenantId,
      input.caseId,
    );

    if (!stored) {
      return null;
    }

    assertCanReadCaseAggregate(
      membership,
      stored.aggregate,
    );

    return stored;
  }

  async metrics(input: CaseQueryInput): Promise<CaseMetrics> {
    const membership = await this.membershipFor(
      input.tenantId,
      input.principalId,
    );
    assertCanReadCase(membership);

    const stored = await this.repository.load(
      input.tenantId,
      input.caseId,
    );

    if (!stored) {
      throw new CaseNotFoundError(input.tenantId, input.caseId);
    }

    assertCanReadCaseAggregate(
      membership,
      stored.aggregate,
    );

    return calculateCaseMetrics(stored.events);
  }

  async current(input: CaseQueryInput): Promise<CaseAggregate> {
    const membership = await this.membershipFor(
      input.tenantId,
      input.principalId,
    );
    assertCanReadCase(membership);

    const stored = await this.repository.load(
      input.tenantId,
      input.caseId,
    );

    if (!stored) {
      throw new CaseNotFoundError(input.tenantId, input.caseId);
    }

    assertCanReadCaseAggregate(
      membership,
      stored.aggregate,
    );

    return stored.aggregate;
  }
}
