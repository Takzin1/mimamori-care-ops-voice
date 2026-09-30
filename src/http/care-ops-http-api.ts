import type {
  AuthenticatedCareOpsGateway,
} from "../application/authenticated-gateway.ts";
import {
  CaseAccessDeniedError,
} from "../access/errors.ts";
import {
  CaseConflictError,
  InvalidTransitionError,
} from "../core/errors.ts";
import {
  AuthenticationError,
} from "../identity/types.ts";
import {
  TenantSlaPolicyNotFoundError,
} from "../operations/policy-directory.ts";
import {
  CaseNotFoundError,
  CaseStoreCorruptionError,
  CaseStoreTransportError,
} from "../persistence/errors.ts";
import { readBoundedJson } from "./body.ts";
import {
  parseCaseCommandRequest,
} from "./command-parser.ts";
import {
  HttpRequestError,
} from "./errors.ts";
import type {
  HttpApiErrorBody,
  RequestIdFactory,
} from "./types.ts";

export interface CareOpsHttpApiOptions {
  gateway: AuthenticatedCareOpsGateway;
  requestIdFactory?: RequestIdFactory;
  maxCommandBodyBytes?: number;
}

type Route =
  | {
      kind: "operator";
      tenantId: string;
    }
  | {
      kind: "queue";
      tenantId: string;
    }
  | {
      kind: "case";
      tenantId: string;
      caseId: string;
    }
  | {
      kind: "metrics";
      tenantId: string;
      caseId: string;
    }
  | {
      kind: "capabilities";
      tenantId: string;
      caseId: string;
    }
  | {
      kind: "commands";
      tenantId: string;
      caseId: string;
    };

const SAFE_IDENTIFIER = /^[A-Za-z0-9._:-]{1,128}$/;
const MAX_ACCESS_TOKEN_LENGTH = 8 * 1024;

function defaultRequestIdFactory(): string {
  return crypto.randomUUID();
}

function safeIdentifier(
  raw: string,
  label: string,
): string {
  let decoded: string;

  try {
    decoded = decodeURIComponent(raw);
  } catch {
    throw new HttpRequestError(
      400,
      "INVALID_PATH",
      "Path contains invalid encoding",
    );
  }

  if (!SAFE_IDENTIFIER.test(decoded)) {
    throw new HttpRequestError(
      400,
      "INVALID_PATH",
      `${label} is not a valid path identifier`,
    );
  }

  return decoded;
}

function routeFor(request: Request): Route {
  const url = new URL(request.url);
  const parts = url.pathname.split("/");

  if (
    parts.length === 6 &&
    parts[0] === "" &&
    parts[1] === "api" &&
    parts[2] === "care-ops" &&
    parts[3] === "tenants" &&
    parts[5] === "operator"
  ) {
    return {
      kind: "operator",
      tenantId: safeIdentifier(
        parts[4]!,
        "tenantId",
      ),
    };
  }

  if (
    parts.length === 6 &&
    parts[0] === "" &&
    parts[1] === "api" &&
    parts[2] === "care-ops" &&
    parts[3] === "tenants" &&
    parts[5] === "queue"
  ) {
    return {
      kind: "queue",
      tenantId: safeIdentifier(
        parts[4]!,
        "tenantId",
      ),
    };
  }

  if (
    parts.length === 7 &&
    parts[0] === "" &&
    parts[1] === "api" &&
    parts[2] === "care-ops" &&
    parts[3] === "tenants" &&
    parts[5] === "cases"
  ) {
    return {
      kind: "case",
      tenantId: safeIdentifier(
        parts[4]!,
        "tenantId",
      ),
      caseId: safeIdentifier(
        parts[6]!,
        "caseId",
      ),
    };
  }

  if (
    parts.length === 8 &&
    parts[0] === "" &&
    parts[1] === "api" &&
    parts[2] === "care-ops" &&
    parts[3] === "tenants" &&
    parts[5] === "cases" &&
    parts[7] === "metrics"
  ) {
    return {
      kind: "metrics",
      tenantId: safeIdentifier(
        parts[4]!,
        "tenantId",
      ),
      caseId: safeIdentifier(
        parts[6]!,
        "caseId",
      ),
    };
  }

  if (
    parts.length === 8 &&
    parts[0] === "" &&
    parts[1] === "api" &&
    parts[2] === "care-ops" &&
    parts[3] === "tenants" &&
    parts[5] === "cases" &&
    parts[7] === "capabilities"
  ) {
    return {
      kind: "capabilities",
      tenantId: safeIdentifier(
        parts[4]!,
        "tenantId",
      ),
      caseId: safeIdentifier(
        parts[6]!,
        "caseId",
      ),
    };
  }

  if (
    parts.length === 8 &&
    parts[0] === "" &&
    parts[1] === "api" &&
    parts[2] === "care-ops" &&
    parts[3] === "tenants" &&
    parts[5] === "cases" &&
    parts[7] === "commands"
  ) {
    return {
      kind: "commands",
      tenantId: safeIdentifier(
        parts[4]!,
        "tenantId",
      ),
      caseId: safeIdentifier(
        parts[6]!,
        "caseId",
      ),
    };
  }

  throw new HttpRequestError(
    404,
    "ROUTE_NOT_FOUND",
    "Route not found",
  );
}

function allowedMethods(
  route: Route,
): readonly string[] {
  switch (route.kind) {
    case "operator":
    case "queue":
    case "case":
    case "metrics":
    case "capabilities":
      return ["GET"];
    case "commands":
      return ["POST"];
  }
}

function assertMethod(
  request: Request,
  route: Route,
): void {
  if (!allowedMethods(route).includes(request.method)) {
    throw new HttpRequestError(
      405,
      "METHOD_NOT_ALLOWED",
      "Method not allowed",
    );
  }
}

function accessToken(request: Request): string {
  const header = request.headers.get("authorization");

  if (!header) {
    throw new AuthenticationError();
  }

  const match = /^Bearer ([^\s,]+)$/i.exec(header);
  if (!match) {
    throw new AuthenticationError();
  }

  const token = match[1]!;
  if (
    token.length < 1 ||
    token.length > MAX_ACCESS_TOKEN_LENGTH
  ) {
    throw new AuthenticationError();
  }

  return token;
}

function baseHeaders(
  requestId: string,
): Headers {
  return new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "vary": "Authorization",
    "x-request-id": requestId,
  });
}

function json(
  value: unknown,
  status: number,
  requestId: string,
  extraHeaders?: HeadersInit,
): Response {
  const headers = baseHeaders(requestId);

  if (extraHeaders) {
    const extras = new Headers(extraHeaders);
    extras.forEach((value, key) => {
      headers.set(key, value);
    });
  }

  return new Response(
    JSON.stringify(value),
    {
      status,
      headers,
    },
  );
}

function errorBody(
  code: string,
  message: string,
  requestId: string,
  details?: Record<string, unknown>,
): HttpApiErrorBody {
  return {
    error: {
      code,
      message,
      requestId,
      ...(details ? { details } : {}),
    },
  };
}

function errorResponse(
  error: unknown,
  requestId: string,
): Response {
  if (error instanceof HttpRequestError) {
    return json(
      errorBody(
        error.code,
        error.message,
        requestId,
      ),
      error.status,
      requestId,
    );
  }

  if (error instanceof AuthenticationError) {
    return json(
      errorBody(
        "AUTHENTICATION_REQUIRED",
        "Authentication required",
        requestId,
      ),
      401,
      requestId,
    );
  }

  if (error instanceof CaseAccessDeniedError) {
    return json(
      errorBody(
        "FORBIDDEN",
        "Access denied",
        requestId,
      ),
      403,
      requestId,
    );
  }

  if (error instanceof CaseNotFoundError) {
    return json(
      errorBody(
        "CASE_NOT_FOUND",
        "Case not found",
        requestId,
      ),
      404,
      requestId,
    );
  }

  if (error instanceof CaseConflictError) {
    return json(
      errorBody(
        error.code,
        "Case version conflict",
        requestId,
        {
          expectedVersion: error.expectedVersion,
          actualVersion: error.actualVersion,
        },
      ),
      409,
      requestId,
    );
  }

  if (error instanceof InvalidTransitionError) {
    return json(
      errorBody(
        error.code,
        "Case transition is not allowed",
        requestId,
      ),
      422,
      requestId,
    );
  }

  if (
    error instanceof CaseStoreTransportError ||
    error instanceof TenantSlaPolicyNotFoundError
  ) {
    return json(
      errorBody(
        "CARE_OPS_UNAVAILABLE",
        "Care Operations service is unavailable",
        requestId,
      ),
      503,
      requestId,
    );
  }

  if (error instanceof CaseStoreCorruptionError) {
    return json(
      errorBody(
        "INTERNAL_ERROR",
        "Internal server error",
        requestId,
      ),
      500,
      requestId,
    );
  }

  return json(
    errorBody(
      "INTERNAL_ERROR",
      "Internal server error",
      requestId,
    ),
    500,
    requestId,
  );
}

export class CareOpsHttpApi {
  private readonly gateway: AuthenticatedCareOpsGateway;
  private readonly makeRequestId: RequestIdFactory;
  private readonly maxCommandBodyBytes: number;

  constructor(options: CareOpsHttpApiOptions) {
    this.gateway = options.gateway;
    this.makeRequestId =
      options.requestIdFactory ??
      defaultRequestIdFactory;
    this.maxCommandBodyBytes =
      options.maxCommandBodyBytes ??
      32 * 1024;

    if (
      !Number.isInteger(this.maxCommandBodyBytes) ||
      this.maxCommandBodyBytes < 1
    ) {
      throw new Error(
        "maxCommandBodyBytes must be a positive integer",
      );
    }
  }

  private async command(
    request: Request,
    route: Extract<Route, { kind: "commands" }>,
    token: string,
    requestId: string,
  ): Promise<Response> {
    const parsed = parseCaseCommandRequest(
      await readBoundedJson(
        request,
        this.maxCommandBodyBytes,
      ),
    );

    const result = await this.gateway.execute({
      accessToken: token,
      tenantId: route.tenantId,
      caseId: route.caseId,
      expectedVersion: parsed.expectedVersion,
      command: parsed.command,
    });

    return json(
      result,
      200,
      requestId,
      {
        "x-case-version":
          String(result.aggregate.version),
      },
    );
  }

  async handle(
    request: Request,
  ): Promise<Response> {
    const requestId = this.makeRequestId();

    try {
      const route = routeFor(request);
      assertMethod(request, route);
      const token = accessToken(request);

      switch (route.kind) {
        case "operator": {
          const projection =
            await this.gateway.operatorContext({
              accessToken: token,
              tenantId: route.tenantId,
            });

          return json(
            projection,
            200,
            requestId,
          );
        }

        case "queue": {
          const projection = await this.gateway.queue({
            accessToken: token,
            tenantId: route.tenantId,
          });

          return json(
            projection,
            200,
            requestId,
          );
        }

        case "case": {
          const stored = await this.gateway.get({
            accessToken: token,
            tenantId: route.tenantId,
            caseId: route.caseId,
          });

          if (!stored) {
            throw new CaseNotFoundError(
              route.tenantId,
              route.caseId,
            );
          }

          return json(
            stored,
            200,
            requestId,
            {
              "x-case-version":
                String(stored.aggregate.version),
            },
          );
        }

        case "metrics": {
          const metrics = await this.gateway.metrics({
            accessToken: token,
            tenantId: route.tenantId,
            caseId: route.caseId,
          });

          return json(
            metrics,
            200,
            requestId,
          );
        }

        case "capabilities": {
          const projection =
            await this.gateway.capabilities({
              accessToken: token,
              tenantId: route.tenantId,
              caseId: route.caseId,
            });

          return json(
            projection,
            200,
            requestId,
          );
        }

        case "commands":
          return await this.command(
            request,
            route,
            token,
            requestId,
          );
      }
    } catch (error) {
      const response = errorResponse(
        error,
        requestId,
      );

      if (
        error instanceof HttpRequestError &&
        error.status === 405
      ) {
        try {
          const route = routeFor(request);
          response.headers.set(
            "allow",
            allowedMethods(route).join(", "),
          );
        } catch {
          // Preserve the original method error response.
        }
      }

      return response;
    }
  }
}
