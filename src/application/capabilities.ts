import {
  canExecuteCommandType,
  queueVisibilityForMembership,
  type CareOpsQueueVisibility,
} from "../access/policy.ts";
import type {
  StaffRole,
  TenantMembership,
} from "../access/types.ts";
import {
  CASE_COMMAND_TYPES,
  canCaseCommand,
  type CaseAggregate,
  type CaseCommandType,
  type CaseStatus,
} from "../core/index.ts";

export type CommandInputRequirement =
  | "priority"
  | "assigneeId"
  | "targetAssigneeId"
  | "outcome"
  | "summary"
  | "evidence"
  | "reason";

export interface OperatorContextProjection {
  tenantId: string;
  actorId: string;
  roles: StaffRole[];
  queueVisibility: CareOpsQueueVisibility;
}

export interface CaseCommandCapability {
  type: CaseCommandType;
  requires: CommandInputRequirement[];
}

export interface CaseCapabilitiesProjection {
  tenantId: string;
  caseId: string;
  version: number;
  status: CaseStatus;
  operator: OperatorContextProjection;
  commands: CaseCommandCapability[];
}

const INPUT_REQUIREMENTS: Record<
  CaseCommandType,
  readonly CommandInputRequirement[]
> = {
  set_priority: ["priority"],
  acknowledge: [],
  assign: ["assigneeId"],
  start_action: [],
  request_handoff: ["targetAssigneeId"],
  accept_handoff: [],
  complete: [
    "outcome",
    "summary",
    "evidence",
  ],
  close: [],
  reopen: ["reason"],
};

export function projectOperatorContext(
  membership: TenantMembership,
): OperatorContextProjection {
  return {
    tenantId: membership.tenantId,
    actorId: membership.actorId,
    roles: [...membership.roles],
    queueVisibility:
      queueVisibilityForMembership(
        membership,
      ),
  };
}

export function projectCaseCapabilities(
  aggregate: CaseAggregate,
  membership: TenantMembership,
): CaseCapabilitiesProjection {
  const commands = CASE_COMMAND_TYPES
    .filter(
      (type) =>
        canExecuteCommandType(
          membership,
          type,
        ) &&
        canCaseCommand(
          aggregate,
          membership.actorId,
          type,
        ),
    )
    .map((type) => ({
      type,
      requires: [
        ...INPUT_REQUIREMENTS[type],
      ],
    }));

  return {
    tenantId: aggregate.tenantId,
    caseId: aggregate.id,
    version: aggregate.version,
    status: aggregate.status,
    operator:
      projectOperatorContext(membership),
    commands,
  };
}
