export type AccessDenialReason =
  | "membership_required"
  | "membership_inactive"
  | "command_forbidden"
  | "case_not_visible"
  | "target_not_assignable";

export class CaseAccessDeniedError extends Error {
  readonly code = "CASE_ACCESS_DENIED";
  readonly reason: AccessDenialReason;

  constructor(reason: AccessDenialReason) {
    super("Case access denied");
    this.name = "CaseAccessDeniedError";
    this.reason = reason;
  }
}
