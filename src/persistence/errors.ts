export class CaseNotFoundError extends Error {
  readonly code = "CASE_NOT_FOUND";

  constructor(tenantId: string, caseId: string) {
    super(`Case not found: ${tenantId}/${caseId}`);
    this.name = "CaseNotFoundError";
  }
}

export class DuplicateCaseError extends Error {
  readonly code = "DUPLICATE_CASE";

  constructor(tenantId: string, caseId: string) {
    super(`Case already exists: ${tenantId}/${caseId}`);
    this.name = "DuplicateCaseError";
  }
}


export class SignalReplayMismatchError extends Error {
  readonly code = "SIGNAL_REPLAY_MISMATCH";

  constructor(
    tenantId: string,
    sourceAdapter: string,
    sourceSignalId: string,
  ) {
    super(
      `Signal replay payload mismatch: ${tenantId}/${sourceAdapter}/${sourceSignalId}`,
    );
    this.name = "SignalReplayMismatchError";
  }
}


export class CaseStoreCorruptionError extends Error {
  readonly code = "CASE_STORE_CORRUPTION";

  constructor(message: string) {
    super(message);
    this.name = "CaseStoreCorruptionError";
  }
}

export class CaseStoreTransportError extends Error {
  readonly code = "CASE_STORE_TRANSPORT_ERROR";
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "CaseStoreTransportError";
    this.status = status;
  }
}
