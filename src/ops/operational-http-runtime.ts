import {
  canonicalBrowserOrigin,
} from "./exact-browser-origin-policy.ts";
import type {
  CareOpsAdmissionDecision,
  CareOpsMetricLabels,
  CareOpsOperationalLogRecord,
  CareOpsRouteClass,
  OperationalCareOpsRuntimeOptions,
} from "./types.ts";

const MAX_RETRY_AFTER_SECONDS = 3600;
const CORS_MAX_AGE_SECONDS = 600;
const CORS_ALLOWED_METHODS =
  new Set(["GET", "POST"]);
const CORS_ALLOWED_HEADERS =
  new Set(["authorization", "content-type"]);

function json(
  body: unknown,
  status: number,
  requestId?: string,
  extraHeaders?: HeadersInit,
): Response {
  const headers = new Headers({
    "content-type":
      "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });

  if (requestId) {
    headers.set(
      "x-request-id",
      requestId,
    );
  }

  if (extraHeaders) {
    const extra =
      new Headers(extraHeaders);
    extra.forEach((value, key) => {
      headers.set(key, value);
    });
  }

  return new Response(
    JSON.stringify(body),
    {
      status,
      headers,
    },
  );
}

function careOpsError(
  code: string,
  message: string,
  status: number,
  requestId: string,
  retryAfterSeconds?: number,
): Response {
  const headers = new Headers({
    vary: "Authorization",
  });

  if (
    retryAfterSeconds !== undefined
  ) {
    headers.set(
      "retry-after",
      String(retryAfterSeconds),
    );
  }

  return json(
    {
      error: {
        code,
        message,
        requestId,
      },
    },
    status,
    requestId,
    headers,
  );
}

function appendVary(
  headers: Headers,
  value: string,
): void {
  const current =
    headers.get("vary")
      ?.split(",")
      .map((item) => item.trim())
      .filter(Boolean) ?? [];

  if (
    !current.some(
      (item) =>
        item.toLowerCase() ===
        value.toLowerCase(),
    )
  ) {
    current.push(value);
  }

  headers.set(
    "vary",
    current.join(", "),
  );
}

function withAllowedOrigin(
  response: Response,
  origin: string,
): Response {
  const headers =
    new Headers(response.headers);

  headers.set(
    "access-control-allow-origin",
    origin,
  );
  headers.delete(
    "access-control-allow-credentials",
  );
  appendVary(headers, "Origin");

  return new Response(
    response.body,
    {
      status: response.status,
      statusText: response.statusText,
      headers,
    },
  );
}

function requestedHeaders(
  request: Request,
): readonly string[] {
  const raw =
    request.headers.get(
      "access-control-request-headers",
    );

  if (!raw?.trim()) {
    return [];
  }

  return raw
    .split(",")
    .map((value) =>
      value.trim().toLowerCase(),
    )
    .filter(Boolean);
}

function isCareOpsApiPath(
  request: Request,
): boolean {
  return new URL(
    request.url,
  ).pathname.startsWith(
    "/api/care-ops/",
  );
}

function preflightResponse(
  request: Request,
  origin: string,
): Response {
  const requestedMethod =
    request.headers
      .get(
        "access-control-request-method",
      )
      ?.trim()
      .toUpperCase();

  if (
    !requestedMethod ||
    !CORS_ALLOWED_METHODS.has(
      requestedMethod,
    )
  ) {
    throw new Error(
      "CORS method is not allowed",
    );
  }

  const headers =
    requestedHeaders(request);

  if (
    headers.some(
      (header) =>
        !CORS_ALLOWED_HEADERS.has(header),
    )
  ) {
    throw new Error(
      "CORS header is not allowed",
    );
  }

  const responseHeaders =
    new Headers({
      "cache-control": "no-store",
      "x-content-type-options":
        "nosniff",
      "referrer-policy":
        "no-referrer",
      "access-control-allow-origin":
        origin,
      "access-control-allow-methods":
        requestedMethod,
      "access-control-max-age":
        String(
          CORS_MAX_AGE_SECONDS,
        ),
    });

  if (headers.length > 0) {
    responseHeaders.set(
      "access-control-allow-headers",
      "Authorization, Content-Type",
    );
  }

  appendVary(
    responseHeaders,
    "Origin",
  );
  appendVary(
    responseHeaders,
    "Access-Control-Request-Method",
  );
  appendVary(
    responseHeaders,
    "Access-Control-Request-Headers",
  );

  return new Response(null, {
    status: 204,
    headers: responseHeaders,
  });
}

function statusClass(
  status: number,
): string {
  if (status >= 100 && status <= 599) {
    return `${Math.floor(status / 100)}xx`;
  }

  return "unknown";
}

function method(
  request: Request,
): string {
  return request.method
    .trim()
    .toUpperCase() || "UNKNOWN";
}

function routeClass(
  request: Request,
): CareOpsRouteClass {
  const pathname =
    new URL(request.url).pathname;

  if (pathname === "/healthz") {
    return "health";
  }

  if (pathname === "/readyz") {
    return "readiness";
  }

  return "care_ops";
}

function bodyless(
  response: Response,
  requestMethod: string,
): Response {
  if (requestMethod !== "HEAD") {
    return response;
  }

  return new Response(null, {
    status: response.status,
    headers: response.headers,
  });
}

function admissionDecision(
  value: unknown,
): CareOpsAdmissionDecision {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error(
      "invalid admission decision",
    );
  }

  const decision =
    value as Record<string, unknown>;

  if (decision.allowed === true) {
    return { allowed: true };
  }

  if (decision.allowed !== false) {
    throw new Error(
      "invalid admission decision",
    );
  }

  const retryAfter =
    decision.retryAfterSeconds;

  if (retryAfter === undefined) {
    return { allowed: false };
  }

  if (
    !Number.isSafeInteger(retryAfter) ||
    (retryAfter as number) < 1 ||
    (retryAfter as number) >
      MAX_RETRY_AFTER_SECONDS
  ) {
    throw new Error(
      "invalid retry-after value",
    );
  }

  return {
    allowed: false,
    retryAfterSeconds:
      retryAfter as number,
  };
}

export class OperationalCareOpsRuntime {
  readonly #handler:
    OperationalCareOpsRuntimeOptions["handler"];
  readonly #logger:
    OperationalCareOpsRuntimeOptions["logger"];
  readonly #metrics:
    OperationalCareOpsRuntimeOptions["metrics"];
  readonly #readinessChecks:
    readonly NonNullable<
      OperationalCareOpsRuntimeOptions[
        "readinessChecks"
      ]
    >[number][];
  readonly #admission:
    OperationalCareOpsRuntimeOptions["admission"];
  readonly #originPolicy:
    OperationalCareOpsRuntimeOptions["originPolicy"];
  readonly #now: () => string;
  readonly #nowMs: () => number;
  readonly #requestIdFactory: () => string;

  constructor(
    options: OperationalCareOpsRuntimeOptions,
  ) {
    this.#handler = options.handler;
    this.#logger = options.logger;
    this.#metrics = options.metrics;
    this.#readinessChecks =
      options.readinessChecks ?? [];
    this.#admission =
      options.admission;
    this.#originPolicy =
      options.originPolicy;
    this.#now =
      options.now ??
      (() => new Date().toISOString());
    this.#nowMs =
      options.nowMs ??
      (() => performance.now());
    this.#requestIdFactory =
      options.requestIdFactory ??
      (() => crypto.randomUUID());
  }

  async #safeLog(
    record: CareOpsOperationalLogRecord,
  ): Promise<void> {
    try {
      await this.#logger?.write(record);
    } catch {
      // Observability must not break request handling.
    }
  }

  async #safeMetrics(
    route: CareOpsRouteClass,
    requestMethod: string,
    status: number,
    durationMs: number,
  ): Promise<void> {
    if (!this.#metrics) return;

    const labels: CareOpsMetricLabels = {
      routeClass: route,
      method: requestMethod,
      statusClass: statusClass(status),
    };

    try {
      await this.#metrics.increment(
        "care_ops_http_requests_total",
        labels,
      );
    } catch {
      // Metrics are best-effort.
    }

    try {
      await this.#metrics.observe(
        "care_ops_http_request_duration_ms",
        durationMs,
        labels,
      );
    } catch {
      // Metrics are best-effort.
    }
  }

  async #finish(
    route: CareOpsRouteClass,
    requestMethod: string,
    response: Response,
    startedAt: number,
  ): Promise<Response> {
    const durationMs = Math.max(
      0,
      this.#nowMs() - startedAt,
    );

    const requestId =
      response.headers.get(
        "x-request-id",
      );

    await this.#safeLog({
      event: "http_request_completed",
      at: this.#now(),
      requestId,
      routeClass: route,
      method: requestMethod,
      status: response.status,
      durationMs,
    });

    await this.#safeMetrics(
      route,
      requestMethod,
      response.status,
      durationMs,
    );

    return response;
  }

  async #health(
    requestMethod: string,
    startedAt: number,
  ): Promise<Response> {
    const response = json(
      { status: "ok" },
      200,
    );

    return bodyless(
      await this.#finish(
        "health",
        requestMethod,
        response,
        startedAt,
      ),
      requestMethod,
    );
  }

  async #readiness(
    requestMethod: string,
    startedAt: number,
  ): Promise<Response> {
    let ready = true;

    for (
      const check of
        this.#readinessChecks
    ) {
      try {
        if (!(await check.check())) {
          ready = false;
        }
      } catch {
        ready = false;
      }
    }

    const status = ready ? 200 : 503;
    const durationMs = Math.max(
      0,
      this.#nowMs() - startedAt,
    );

    await this.#safeLog({
      event: "readiness_evaluated",
      at: this.#now(),
      requestId: null,
      routeClass: "readiness",
      method:
        requestMethod === "HEAD"
          ? "HEAD"
          : "GET",
      status,
      durationMs,
      ready,
      checkCount:
        this.#readinessChecks.length,
    });

    await this.#safeMetrics(
      "readiness",
      requestMethod,
      status,
      durationMs,
    );

    return bodyless(
      json(
        {
          status:
            ready
              ? "ready"
              : "not_ready",
        },
        status,
      ),
      requestMethod,
    );
  }

  async #checkOrigin(
    request: Request,
    requestMethod: string,
    startedAt: number,
  ): Promise<
    | {
        origin: string | null;
        response: Response | null;
      }
  > {
    const origin =
      request.headers.get("origin");

    if (!origin) {
      return {
        origin: null,
        response: null,
      };
    }

    if (!this.#originPolicy) {
      return {
        origin: null,
        response: null,
      };
    }

    let canonical: string;

    try {
      canonical =
        canonicalBrowserOrigin(
          origin,
        );
    } catch {
      const requestId =
        this.#requestIdFactory();

      return {
        origin: null,
        response:
          await this.#finish(
            "care_ops",
            requestMethod,
            careOpsError(
              "ORIGIN_NOT_ALLOWED",
              "Browser origin is not allowed",
              403,
              requestId,
            ),
            startedAt,
          ),
      };
    }

    let allowed = false;

    try {
      allowed =
        await this.#originPolicy.allows(
          canonical,
        );
    } catch {
      const requestId =
        this.#requestIdFactory();

      return {
        origin: null,
        response:
          await this.#finish(
            "care_ops",
            requestMethod,
            careOpsError(
              "ORIGIN_POLICY_UNAVAILABLE",
              "Service temporarily unavailable",
              503,
              requestId,
            ),
            startedAt,
          ),
      };
    }

    if (!allowed) {
      const requestId =
        this.#requestIdFactory();

      return {
        origin: null,
        response:
          await this.#finish(
            "care_ops",
            requestMethod,
            careOpsError(
              "ORIGIN_NOT_ALLOWED",
              "Browser origin is not allowed",
              403,
              requestId,
            ),
            startedAt,
          ),
      };
    }

    return {
      origin: canonical,
      response: null,
    };
  }

  async #preflight(
    request: Request,
    origin: string,
    requestMethod: string,
    startedAt: number,
  ): Promise<Response> {
    let response: Response;

    try {
      if (
        requestMethod !== "OPTIONS" ||
        !isCareOpsApiPath(request)
      ) {
        throw new Error(
          "not a Care Ops preflight",
        );
      }

      response =
        preflightResponse(
          request,
          origin,
        );
    } catch {
      const requestId =
        this.#requestIdFactory();

      response =
        withAllowedOrigin(
          careOpsError(
            "CORS_PREFLIGHT_REJECTED",
            "CORS preflight is not allowed",
            403,
            requestId,
          ),
          origin,
        );
    }

    return await this.#finish(
      "care_ops",
      requestMethod,
      response,
      startedAt,
    );
  }

  async #admit(
    request: Request,
    requestMethod: string,
    startedAt: number,
  ): Promise<Response | null> {
    if (!this.#admission) {
      return null;
    }

    let decision: CareOpsAdmissionDecision;

    try {
      decision = admissionDecision(
        await this.#admission.admit({
          request,
          method: requestMethod,
          routeClass: "care_ops",
        }),
      );
    } catch {
      const requestId =
        this.#requestIdFactory();

      return await this.#finish(
        "care_ops",
        requestMethod,
        careOpsError(
          "ADMISSION_UNAVAILABLE",
          "Service temporarily unavailable",
          503,
          requestId,
        ),
        startedAt,
      );
    }

    if (decision.allowed) {
      return null;
    }

    const requestId =
      this.#requestIdFactory();

    return await this.#finish(
      "care_ops",
      requestMethod,
      careOpsError(
        "RATE_LIMITED",
        "Too many requests",
        429,
        requestId,
        decision.retryAfterSeconds,
      ),
      startedAt,
    );
  }

  async handle(
    request: Request,
  ): Promise<Response> {
    const startedAt =
      this.#nowMs();
    const requestMethod =
      method(request);
    const route =
      routeClass(request);

    if (
      route === "health" &&
      (
        requestMethod === "GET" ||
        requestMethod === "HEAD"
      )
    ) {
      return this.#health(
        requestMethod,
        startedAt,
      );
    }

    if (
      route === "readiness" &&
      (
        requestMethod === "GET" ||
        requestMethod === "HEAD"
      )
    ) {
      return this.#readiness(
        requestMethod,
        startedAt,
      );
    }

    const originCheck =
      await this.#checkOrigin(
        request,
        requestMethod,
        startedAt,
      );

    if (originCheck.response) {
      return originCheck.response;
    }

    const allowedOrigin =
      originCheck.origin;

    if (
      requestMethod === "OPTIONS" &&
      allowedOrigin
    ) {
      return await this.#preflight(
        request,
        allowedOrigin,
        requestMethod,
        startedAt,
      );
    }

    const admissionResponse =
      await this.#admit(
        request,
        requestMethod,
        startedAt,
      );

    if (admissionResponse) {
      return allowedOrigin
        ? withAllowedOrigin(
            admissionResponse,
            allowedOrigin,
          )
        : admissionResponse;
    }

    try {
      let response =
        await this.#handler.handle(request);

      if (allowedOrigin) {
        response =
          withAllowedOrigin(
            response,
            allowedOrigin,
          );
      }

      return await this.#finish(
        "care_ops",
        requestMethod,
        response,
        startedAt,
      );
    } catch {
      const requestId =
        this.#requestIdFactory();

      let response = careOpsError(
        "INTERNAL_ERROR",
        "Internal server error",
        500,
        requestId,
      );

      if (allowedOrigin) {
        response =
          withAllowedOrigin(
            response,
            allowedOrigin,
          );
      }

      return await this.#finish(
        "care_ops",
        requestMethod,
        response,
        startedAt,
      );
    }
  }
}
