export class CareOpsSessionUnavailableError extends Error {
  readonly code = "CARE_OPS_SESSION_UNAVAILABLE";

  constructor(
    message = "Care Ops session requires authentication",
  ) {
    super(message);
    this.name = "CareOpsSessionUnavailableError";
  }
}

export class CareOpsSessionDisposedError extends Error {
  readonly code = "CARE_OPS_SESSION_DISPOSED";

  constructor() {
    super("Care Ops session controller is disposed");
    this.name = "CareOpsSessionDisposedError";
  }
}
