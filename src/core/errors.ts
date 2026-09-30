export class CaseConflictError extends Error {
  readonly code = "CASE_VERSION_CONFLICT";
  readonly expectedVersion: number;
  readonly actualVersion: number;

  constructor(expectedVersion: number, actualVersion: number) {
    super(
      `Case version conflict: expected ${expectedVersion}, actual ${actualVersion}`,
    );
    this.name = "CaseConflictError";
    this.expectedVersion = expectedVersion;
    this.actualVersion = actualVersion;
  }
}

export class InvalidTransitionError extends Error {
  readonly code = "INVALID_CASE_TRANSITION";

  constructor(message: string) {
    super(message);
    this.name = "InvalidTransitionError";
  }
}
