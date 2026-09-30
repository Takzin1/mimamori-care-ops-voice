export class CareOpsHttpClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;
  readonly details: Readonly<Record<string, unknown>> | null;

  constructor(options: {
    status: number;
    code: string;
    message: string;
    requestId?: string | null;
    details?: Readonly<Record<string, unknown>> | null;
  }) {
    super(options.message);
    this.name = "CareOpsHttpClientError";
    this.status = options.status;
    this.code = options.code;
    this.requestId = options.requestId ?? null;
    this.details = options.details ?? null;
  }
}

export class CareOpsHttpProtocolError extends Error {
  readonly code = "CARE_OPS_HTTP_PROTOCOL_ERROR";

  constructor(message = "Care Ops API returned an invalid response") {
    super(message);
    this.name = "CareOpsHttpProtocolError";
  }
}

export class CareOpsClientConfigurationError extends Error {
  readonly code = "CARE_OPS_CLIENT_CONFIGURATION_ERROR";

  constructor(message: string) {
    super(message);
    this.name = "CareOpsClientConfigurationError";
  }
}
