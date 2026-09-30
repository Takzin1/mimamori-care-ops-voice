import {
  isOperationalActorId,
} from "../access/actor-id.ts";
import type {
  CaseCommandIntent,
} from "../application/types.ts";
import {
  CASE_PRIORITIES,
  COMPLETION_OUTCOMES,
  EVIDENCE_KINDS,
  type CaseCommandType,
  type CasePriority,
  type CompletionOutcome,
  type EvidenceKind,
} from "../core/types.ts";
import { ConsoleWebInputError } from "./errors.ts";
import type {
  ConsoleCommandFormValues,
} from "./types.ts";

function required(
  value: string | undefined,
  label: string,
  maxLength?: number,
): string {
  const normalized =
    value?.trim() ?? "";

  if (!normalized) {
    throw new ConsoleWebInputError(
      `${label} is required`,
    );
  }

  if (
    maxLength !== undefined &&
    normalized.length > maxLength
  ) {
    throw new ConsoleWebInputError(
      `${label} is too long`,
    );
  }

  return normalized;
}

function actorId(
  value: string | undefined,
  label: string,
): string {
  const normalized = required(
    value,
    label,
    128,
  );

  if (!isOperationalActorId(normalized)) {
    throw new ConsoleWebInputError(
      `${label} has invalid format`,
    );
  }

  return normalized;
}

function oneOf<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  label: string,
): T {
  const normalized =
    required(value, label);

  if (
    !allowed.includes(
      normalized as T,
    )
  ) {
    throw new ConsoleWebInputError(
      `${label} is invalid`,
    );
  }

  return normalized as T;
}

export function buildConsoleCommandIntent(
  type: CaseCommandType,
  values: ConsoleCommandFormValues = {},
): CaseCommandIntent {
  switch (type) {
    case "set_priority":
      return {
        type,
        priority: oneOf(
          values.priority,
          CASE_PRIORITIES,
          "priority",
        ) as CasePriority,
      };

    case "acknowledge":
      return { type };

    case "assign":
      return {
        type,
        assigneeId: actorId(
          values.assigneeId,
          "assigneeId",
        ),
      };

    case "start_action":
      return { type };

    case "request_handoff":
      return {
        type,
        targetAssigneeId: actorId(
          values.targetAssigneeId,
          "targetAssigneeId",
        ),
      };

    case "accept_handoff":
      return { type };

    case "complete":
      return {
        type,
        outcome: oneOf(
          values.outcome,
          COMPLETION_OUTCOMES,
          "outcome",
        ) as CompletionOutcome,
        summary: required(
          values.summary,
          "summary",
          4000,
        ),
        evidence: [
          {
            kind: oneOf(
              values.evidenceKind,
              EVIDENCE_KINDS,
              "evidenceKind",
            ) as EvidenceKind,
            ref: required(
              values.evidenceRef,
              "evidenceRef",
              1000,
            ),
          },
        ],
      };

    case "close":
      return { type };

    case "reopen":
      return {
        type,
        reason: required(
          values.reason,
          "reason",
          1000,
        ),
      };
  }
}
