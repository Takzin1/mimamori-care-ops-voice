import type { CaseCommandIntent } from "../application/types.ts";
import type {
  CaseAggregate,
  CaseCommandType,
} from "../core/types.ts";
import { CaseAccessDeniedError } from "./errors.ts";
import type {
  StaffRole,
  TenantMembership,
} from "./types.ts";

const TENANT_WIDE_QUEUE_ROLES: readonly StaffRole[] = [
  "dispatcher",
  "supervisor",
  "auditor",
];

export type CareOpsQueueVisibility =
  | "tenant"
  | "responder";

const COMMAND_ROLES: Record<CaseCommandIntent["type"], readonly StaffRole[]> = {
  set_priority: ["dispatcher", "supervisor"],
  acknowledge: ["dispatcher", "supervisor"],
  assign: ["dispatcher", "supervisor"],
  start_action: ["responder", "supervisor"],
  request_handoff: ["responder", "supervisor"],
  accept_handoff: ["responder", "supervisor"],
  complete: ["responder", "supervisor"],
  close: ["dispatcher", "supervisor"],
  reopen: ["supervisor"],
};

function hasAnyRole(
  membership: TenantMembership,
  allowed: readonly StaffRole[],
): boolean {
  return membership.roles.some((role) => allowed.includes(role));
}

export function assertActiveMembership(
  membership: TenantMembership | null,
): asserts membership is TenantMembership {
  if (!membership) {
    throw new CaseAccessDeniedError("membership_required");
  }
  if (!membership.active) {
    throw new CaseAccessDeniedError("membership_inactive");
  }
}

export function assertCanReadCase(
  membership: TenantMembership | null,
): asserts membership is TenantMembership {
  assertActiveMembership(membership);

  if (membership.roles.length === 0) {
    throw new CaseAccessDeniedError("command_forbidden");
  }
}

export function assertCanReadCaseAggregate(
  membership: TenantMembership | null,
  aggregate: CaseAggregate,
): asserts membership is TenantMembership {
  assertCanReadCase(membership);

  if (
    queueVisibilityForMembership(membership) ===
    "tenant"
  ) {
    return;
  }

  if (
    aggregate.assigneeId !== membership.actorId &&
    aggregate.handoffTargetId !== membership.actorId
  ) {
    throw new CaseAccessDeniedError(
      "case_not_visible",
    );
  }
}

export function canExecuteCommandType(
  membership: TenantMembership | null,
  type: CaseCommandType,
): membership is TenantMembership {
  return Boolean(
    membership &&
    membership.active &&
    hasAnyRole(
      membership,
      COMMAND_ROLES[type],
    ),
  );
}

export function assertCanExecuteCommand(
  membership: TenantMembership | null,
  command: CaseCommandIntent,
): asserts membership is TenantMembership {
  assertActiveMembership(membership);

  if (
    !canExecuteCommandType(
      membership,
      command.type,
    )
  ) {
    throw new CaseAccessDeniedError("command_forbidden");
  }
}

export function assertAssignableTarget(
  membership: TenantMembership | null,
): asserts membership is TenantMembership {
  if (
    !membership ||
    !membership.active ||
    !hasAnyRole(membership, ["responder", "supervisor"])
  ) {
    throw new CaseAccessDeniedError("target_not_assignable");
  }
}


export function queueVisibilityForMembership(
  membership: TenantMembership,
): CareOpsQueueVisibility {
  return membership.roles.some(
    (role) =>
      TENANT_WIDE_QUEUE_ROLES.includes(role),
  )
    ? "tenant"
    : "responder";
}
