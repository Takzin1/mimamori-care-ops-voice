import type {
  CaseCapabilitiesProjection,
  OperatorContextProjection,
} from "../application/capabilities.ts";
import type {
  CaseCommandIntent,
} from "../application/types.ts";
import type {
  CaseMetrics,
} from "../core/metrics.ts";
import type {
  CaseOperationResult,
} from "../application/types.ts";
import type {
  CaseQueueProjection,
} from "../operations/queue.ts";
import type {
  StoredCase,
} from "../persistence/types.ts";
import {
  CareOpsClientConfigurationError,
  CareOpsHttpClientError,
  CareOpsHttpProtocolError,
} from "./errors.ts";
import type {
  AccessTokenProvider,
  CareOpsClient,
  CareOpsHttpClientOptions,
} from "./types.ts";

const SAFE_IDENTIFIER = /^[A-Za-z0-9._:-]{1,128}$/;
const MAX_ACCESS_TOKEN_LENGTH = 8 * 1024;

function asRecord(
  value: unknown,
): Record<string, unknown> | null {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return null;
  }

  return value as Record<string, unknown>;
}

function baseOrigin(
  value: string,
): string {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new CareOpsClientConfigurationError(
      "Care Ops base URL must be an absolute URL",
    );
  }

  if (
    url.protocol !== "https:" &&
    url.protocol !== "http:"
  ) {
    throw new CareOpsClientConfigurationError(
      "Care Ops base URL must use http or https",
    );
  }

  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname && url.pathname !== "/")
  ) {
    throw new CareOpsClientConfigurationError(
      "Care Ops base URL must be an origin without credentials, path, query, or fragment",
    );
  }

  return url.origin;
}

function identifier(
  value: string,
  label: string,
): string {
  if (!SAFE_IDENTIFIER.test(value)) {
    throw new CareOpsClientConfigurationError(
      `${label} is not a valid Care Ops identifier`,
    );
  }

  return value;
}

function accessToken(
  value: string,
): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > MAX_ACCESS_TOKEN_LENGTH ||
    !/^[^\s,]+$/.test(value)
  ) {
    throw new CareOpsClientConfigurationError(
      "Access token is unavailable or malformed",
    );
  }

  return value;
}

function expectedVersion(
  value: number,
): number {
  if (
    !Number.isInteger(value) ||
    value < 1
  ) {
    throw new CareOpsClientConfigurationError(
      "expectedVersion must be a positive integer",
    );
  }

  return value;
}

function sanitizedCommand(
  command: CaseCommandIntent,
): CaseCommandIntent {
  switch (command.type) {
    case "set_priority":
      return {
        type: "set_priority",
        priority: command.priority,
      };

    case "acknowledge":
      return {
        type: "acknowledge",
      };

    case "assign":
      return {
        type: "assign",
        assigneeId: command.assigneeId,
      };

    case "start_action":
      return {
        type: "start_action",
      };

    case "request_handoff":
      return {
        type: "request_handoff",
        targetAssigneeId:
          command.targetAssigneeId,
      };

    case "accept_handoff":
      return {
        type: "accept_handoff",
      };

    case "complete":
      return {
        type: "complete",
        outcome: command.outcome,
        summary: command.summary,
        evidence: command.evidence.map(
          (item) => ({
            kind: item.kind,
            ref: item.ref,
          }),
        ),
      };

    case "close":
      return {
        type: "close",
      };

    case "reopen":
      return {
        type: "reopen",
        reason: command.reason,
      };
  }
}

function errorFromResponse(
  status: number,
  value: unknown,
): CareOpsHttpClientError {
  const envelope = asRecord(value);
  const error = asRecord(envelope?.error);

  if (
    !error ||
    typeof error.code !== "string" ||
    typeof error.message !== "string"
  ) {
    throw new CareOpsHttpProtocolError();
  }

  const requestId =
    typeof error.requestId === "string"
      ? error.requestId
      : null;

  const details =
    asRecord(error.details);

  return new CareOpsHttpClientError({
    status,
    code: error.code,
    message: error.message,
    requestId,
    details,
  });
}

async function jsonBody(
  response: Response,
): Promise<unknown> {
  const contentType =
    response.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase();

  if (contentType !== "application/json") {
    throw new CareOpsHttpProtocolError();
  }

  const raw = await response.text();
  if (!raw) {
    throw new CareOpsHttpProtocolError();
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new CareOpsHttpProtocolError();
  }
}

export class CareOpsHttpClient
implements CareOpsClient {
  readonly #baseUrl: string;
  readonly #accessTokenProvider: AccessTokenProvider;
  readonly #fetchImpl: typeof fetch;

  constructor(
    options: CareOpsHttpClientOptions,
  ) {
    this.#baseUrl = baseOrigin(
      options.baseUrl,
    );
    this.#accessTokenProvider =
      options.accessTokenProvider;
    this.#fetchImpl =
      options.fetchImpl ?? fetch;
  }

  private url(path: string): URL {
    return new URL(
      path,
      this.#baseUrl,
    );
  }

  private async request(
    path: string,
    init: {
      method: "GET" | "POST";
      body?: unknown;
    },
  ): Promise<unknown> {
    const token = accessToken(
      await this.#accessTokenProvider(),
    );

    const headers = new Headers({
      accept: "application/json",
      authorization: `Bearer ${token}`,
    });

    let body: string | undefined;
    if (init.body !== undefined) {
      headers.set(
        "content-type",
        "application/json",
      );
      body = JSON.stringify(init.body);
    }

    let response: Response;

    try {
      response = await this.#fetchImpl(
        this.url(path),
        {
          method: init.method,
          headers,
          body,
          cache: "no-store",
          credentials: "omit",
          redirect: "error",
          referrerPolicy: "no-referrer",
        },
      );
    } catch {
      throw new CareOpsHttpProtocolError(
        "Care Ops API request failed",
      );
    }

    const value = await jsonBody(response);

    if (!response.ok) {
      throw errorFromResponse(
        response.status,
        value,
      );
    }

    if (!asRecord(value)) {
      throw new CareOpsHttpProtocolError();
    }

    return value;
  }

  async operatorContext(
    tenantId: string,
  ): Promise<OperatorContextProjection> {
    const tenant = identifier(
      tenantId,
      "tenantId",
    );

    return await this.request(
      `/api/care-ops/tenants/${encodeURIComponent(tenant)}/operator`,
      { method: "GET" },
    ) as unknown as OperatorContextProjection;
  }

  async caseCapabilities(
    tenantId: string,
    caseId: string,
  ): Promise<CaseCapabilitiesProjection> {
    const tenant = identifier(
      tenantId,
      "tenantId",
    );
    const caseIdentity = identifier(
      caseId,
      "caseId",
    );

    return await this.request(
      `/api/care-ops/tenants/${encodeURIComponent(tenant)}/cases/${encodeURIComponent(caseIdentity)}/capabilities`,
      { method: "GET" },
    ) as unknown as CaseCapabilitiesProjection;
  }

  async queue(
    tenantId: string,
  ): Promise<CaseQueueProjection> {
    const tenant = identifier(
      tenantId,
      "tenantId",
    );

    return await this.request(
      `/api/care-ops/tenants/${encodeURIComponent(tenant)}/queue`,
      { method: "GET" },
    ) as CaseQueueProjection;
  }

  async getCase(
    tenantId: string,
    caseId: string,
  ): Promise<StoredCase> {
    const tenant = identifier(
      tenantId,
      "tenantId",
    );
    const caseIdentity = identifier(
      caseId,
      "caseId",
    );

    return await this.request(
      `/api/care-ops/tenants/${encodeURIComponent(tenant)}/cases/${encodeURIComponent(caseIdentity)}`,
      { method: "GET" },
    ) as unknown as StoredCase;
  }

  async metrics(
    tenantId: string,
    caseId: string,
  ): Promise<CaseMetrics> {
    const tenant = identifier(
      tenantId,
      "tenantId",
    );
    const caseIdentity = identifier(
      caseId,
      "caseId",
    );

    return await this.request(
      `/api/care-ops/tenants/${encodeURIComponent(tenant)}/cases/${encodeURIComponent(caseIdentity)}/metrics`,
      { method: "GET" },
    ) as unknown as CaseMetrics;
  }

  async execute(
    tenantId: string,
    caseId: string,
    version: number,
    command: CaseCommandIntent,
  ): Promise<CaseOperationResult> {
    const tenant = identifier(
      tenantId,
      "tenantId",
    );
    const caseIdentity = identifier(
      caseId,
      "caseId",
    );

    return await this.request(
      `/api/care-ops/tenants/${encodeURIComponent(tenant)}/cases/${encodeURIComponent(caseIdentity)}/commands`,
      {
        method: "POST",
        body: {
          expectedVersion:
            expectedVersion(version),
          command:
            sanitizedCommand(command),
        },
      },
    ) as unknown as CaseOperationResult;
  }
}
