import {
  CaseAccessDeniedError,
} from "../access/errors.ts";
import type {
  OperatorContextProjection,
} from "../application/capabilities.ts";

const VOICE_OPS_ROLES =
  new Set([
    "dispatcher",
    "responder",
    "supervisor",
  ]);

export function canUseVoiceOps(
  operator:
    OperatorContextProjection,
): boolean {
  return operator.roles.some(
    (role) =>
      VOICE_OPS_ROLES.has(
        role,
      ),
  );
}

export function assertCanUseVoiceOps(
  operator:
    OperatorContextProjection,
): void {
  if (
    !canUseVoiceOps(
      operator,
    )
  ) {
    throw new CaseAccessDeniedError(
      "command_forbidden",
    );
  }
}
