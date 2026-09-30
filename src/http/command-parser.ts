import type { CaseCommandIntent } from "../application/types.ts";
import { isOperationalActorId } from "../access/actor-id.ts";
import {
  CASE_PRIORITIES,
  COMPLETION_OUTCOMES,
  type CompletionEvidenceItem,
  type CompletionOutcome,
  type EvidenceKind,
} from "../core/types.ts";
import { HttpRequestError } from "./errors.ts";

const EVIDENCE_KINDS: readonly EvidenceKind[] = [
  "note",
  "call",
  "visit",
  "message",
  "external_ref",
];

export interface ParsedCaseCommandRequest {
  expectedVersion: number;
  command: CaseCommandIntent;
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value),
  );
}

function invalid(
  message: string,
): never {
  throw new HttpRequestError(
    400,
    "INVALID_REQUEST",
    message,
  );
}

function assertExactKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(record).filter(
    (key) => !allowedSet.has(key),
  );

  if (unknown.length > 0) {
    invalid(
      `${label} contains unsupported field: ${unknown[0]}`,
    );
  }
}

function requiredText(
  value: unknown,
  label: string,
  maxLength: number,
): string {
  if (typeof value !== "string") {
    invalid(`${label} must be a string`);
  }

  const normalized = value.trim();
  if (!normalized) {
    invalid(`${label} is required`);
  }

  if (normalized.length > maxLength) {
    invalid(`${label} is too long`);
  }

  return normalized;
}

function actorId(
  value: unknown,
  label: string,
): string {
  const normalized = requiredText(
    value,
    label,
    128,
  );

  if (!isOperationalActorId(normalized)) {
    invalid(`${label} has invalid format`);
  }

  return normalized;
}

function expectedVersion(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1
  ) {
    invalid(
      "expectedVersion must be a positive integer",
    );
  }

  return value;
}

function parsePriority(value: unknown) {
  const priority = requiredText(
    value,
    "priority",
    16,
  );

  if (
    !CASE_PRIORITIES.includes(
      priority as (typeof CASE_PRIORITIES)[number],
    )
  ) {
    invalid("priority is not supported");
  }

  return priority as (typeof CASE_PRIORITIES)[number];
}

function parseOutcome(value: unknown): CompletionOutcome {
  const outcome = requiredText(
    value,
    "outcome",
    64,
  );

  if (
    !COMPLETION_OUTCOMES.includes(
      outcome as CompletionOutcome,
    )
  ) {
    invalid("outcome is not supported");
  }

  return outcome as CompletionOutcome;
}

function parseEvidence(
  value: unknown,
): CompletionEvidenceItem[] {
  if (!Array.isArray(value)) {
    invalid("evidence must be an array");
  }

  if (value.length < 1 || value.length > 20) {
    invalid(
      "evidence must contain between 1 and 20 items",
    );
  }

  return value.map((item, index) => {
    if (!isRecord(item)) {
      invalid(
        `evidence[${index}] must be an object`,
      );
    }

    assertExactKeys(
      item,
      ["kind", "ref"],
      `evidence[${index}]`,
    );

    const kind = requiredText(
      item.kind,
      `evidence[${index}].kind`,
      32,
    ) as EvidenceKind;

    if (!EVIDENCE_KINDS.includes(kind)) {
      invalid(
        `evidence[${index}].kind is not supported`,
      );
    }

    return {
      kind,
      ref: requiredText(
        item.ref,
        `evidence[${index}].ref`,
        1000,
      ),
    };
  });
}

function parseCommand(
  value: unknown,
): CaseCommandIntent {
  if (!isRecord(value)) {
    invalid("command must be an object");
  }

  const type = requiredText(
    value.type,
    "command.type",
    64,
  );

  switch (type) {
    case "set_priority":
      assertExactKeys(
        value,
        ["type", "priority"],
        "command",
      );
      return {
        type,
        priority: parsePriority(value.priority),
      };

    case "acknowledge":
    case "start_action":
    case "accept_handoff":
    case "close":
      assertExactKeys(
        value,
        ["type"],
        "command",
      );
      return { type };

    case "assign":
      assertExactKeys(
        value,
        ["type", "assigneeId"],
        "command",
      );
      return {
        type,
        assigneeId: actorId(
          value.assigneeId,
          "assigneeId",
        ),
      };

    case "request_handoff":
      assertExactKeys(
        value,
        ["type", "targetAssigneeId"],
        "command",
      );
      return {
        type,
        targetAssigneeId: actorId(
          value.targetAssigneeId,
          "targetAssigneeId",
        ),
      };

    case "complete":
      assertExactKeys(
        value,
        [
          "type",
          "outcome",
          "summary",
          "evidence",
        ],
        "command",
      );
      return {
        type,
        outcome: parseOutcome(value.outcome),
        summary: requiredText(
          value.summary,
          "summary",
          4000,
        ),
        evidence: parseEvidence(value.evidence),
      };

    case "reopen":
      assertExactKeys(
        value,
        ["type", "reason"],
        "command",
      );
      return {
        type,
        reason: requiredText(
          value.reason,
          "reason",
          1000,
        ),
      };

    default:
      invalid("command.type is not supported");
  }
}

export function parseCaseCommandRequest(
  value: unknown,
): ParsedCaseCommandRequest {
  if (!isRecord(value)) {
    invalid("Request body must be an object");
  }

  assertExactKeys(
    value,
    ["expectedVersion", "command"],
    "request",
  );

  return {
    expectedVersion: expectedVersion(
      value.expectedVersion,
    ),
    command: parseCommand(value.command),
  };
}
