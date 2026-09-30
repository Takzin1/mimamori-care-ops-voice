export type StagingPreflightCheckName =
  | "health"
  | "readiness"
  | "unexpected_origin_rejected"
  | "cors_preflight"
  | "unauthenticated_browser_rejected";

export interface StagingPreflightCheck {
  name: StagingPreflightCheckName;
  passed: boolean;
  status: number | null;
  detail: string;
}

export interface StagingPreflightReport {
  target: string;
  consoleOrigin: string;
  checkedAt: string;
  passed: boolean;
  checks: readonly StagingPreflightCheck[];
}

export interface StagingPreflightOptions {
  baseUrl: string;
  consoleOrigin: string;
  fetchImpl?: typeof fetch;
  now?: () => string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5_000;
const SYNTHETIC_TENANT = "synthetic-preflight";
const UNTRUSTED_ORIGIN = "https://preflight.invalid";

function canonicalHttpUrl(value: string, label: string): URL {
  const url = new URL(value);

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`${label} must use http or https`);
  }

  if (url.username || url.password) {
    throw new Error(`${label} must not contain credentials`);
  }

  return url;
}

function canonicalBaseUrl(value: string): string {
  const url = canonicalHttpUrl(value, "baseUrl");

  if (url.search || url.hash) {
    throw new Error("baseUrl must not contain query or fragment");
  }

  return url.toString().replace(/\/$/, "");
}

function canonicalOrigin(value: string): string {
  const url = canonicalHttpUrl(value, "consoleOrigin");

  if (
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("consoleOrigin must be an origin only");
  }

  return url.origin;
}

async function safeJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const value = await response.json();

    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value)
    ) {
      return null;
    }

    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

function errorCode(body: Record<string, unknown> | null): string | null {
  const error = body?.error;

  if (
    !error ||
    typeof error !== "object" ||
    Array.isArray(error)
  ) {
    return null;
  }

  const code = (error as Record<string, unknown>).code;
  return typeof code === "string" ? code : null;
}

function check(
  name: StagingPreflightCheckName,
  passed: boolean,
  status: number | null,
  detail: string,
): StagingPreflightCheck {
  return { name, passed, status, detail };
}

function requestUrl(baseUrl: string, path: string): string {
  return new URL(path, baseUrl + "/").toString();
}

function requestInit(
  init: RequestInit,
  timeoutMs: number,
): RequestInit {
  return {
    ...init,
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  };
}

export async function runStagingPreflight(
  options: StagingPreflightOptions,
): Promise<StagingPreflightReport> {
  const baseUrl = canonicalBaseUrl(options.baseUrl);
  const consoleOrigin = canonicalOrigin(options.consoleOrigin);
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 100 ||
    timeoutMs > 60_000
  ) {
    throw new Error("timeoutMs must be an integer between 100 and 60000");
  }

  const queuePath =
    `/api/care-ops/tenants/${SYNTHETIC_TENANT}/queue`;
  const checks: StagingPreflightCheck[] = [];

  try {
    const response = await fetchImpl(
      requestUrl(baseUrl, "/healthz"),
      requestInit({ method: "GET" }, timeoutMs),
    );
    const body = await safeJson(response);
    checks.push(
      check(
        "health",
        response.status === 200 && body?.status === "ok",
        response.status,
        response.status === 200 && body?.status === "ok"
          ? "liveness endpoint returned the expected safe response"
          : "liveness endpoint did not match the expected contract",
      ),
    );
  } catch {
    checks.push(
      check(
        "health",
        false,
        null,
        "liveness request failed",
      ),
    );
  }

  try {
    const response = await fetchImpl(
      requestUrl(baseUrl, "/readyz"),
      requestInit({ method: "GET" }, timeoutMs),
    );
    const body = await safeJson(response);
    checks.push(
      check(
        "readiness",
        response.status === 200 && body?.status === "ready",
        response.status,
        response.status === 200 && body?.status === "ready"
          ? "readiness endpoint reported ready"
          : "readiness endpoint is not ready",
      ),
    );
  } catch {
    checks.push(
      check(
        "readiness",
        false,
        null,
        "readiness request failed",
      ),
    );
  }

  try {
    const response = await fetchImpl(
      requestUrl(baseUrl, queuePath),
      requestInit(
        {
          method: "GET",
          headers: {
            Origin: UNTRUSTED_ORIGIN,
          },
        },
        timeoutMs,
      ),
    );
    const body = await safeJson(response);
    const allowedOrigin =
      response.headers.get("access-control-allow-origin");

    checks.push(
      check(
        "unexpected_origin_rejected",
        response.status === 403 &&
          errorCode(body) === "ORIGIN_NOT_ALLOWED" &&
          allowedOrigin === null,
        response.status,
        response.status === 403 &&
          errorCode(body) === "ORIGIN_NOT_ALLOWED" &&
          allowedOrigin === null
          ? "unexpected browser origin failed closed before authentication"
          : "unexpected browser origin was not rejected by the expected boundary",
      ),
    );
  } catch {
    checks.push(
      check(
        "unexpected_origin_rejected",
        false,
        null,
        "unexpected-origin request failed before a verifiable response",
      ),
    );
  }

  try {
    const response = await fetchImpl(
      requestUrl(baseUrl, queuePath),
      requestInit(
        {
          method: "OPTIONS",
          headers: {
            Origin: consoleOrigin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers":
              "Authorization, Content-Type",
          },
        },
        timeoutMs,
      ),
    );

    const allowOrigin =
      response.headers.get("access-control-allow-origin");
    const allowMethods =
      response.headers.get("access-control-allow-methods");
    const allowHeaders =
      response.headers.get("access-control-allow-headers") ?? "";
    const allowCredentials =
      response.headers.get("access-control-allow-credentials");

    const normalizedAllowedHeaders = new Set(
      allowHeaders
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    );

    checks.push(
      check(
        "cors_preflight",
        response.status === 204 &&
          allowOrigin === consoleOrigin &&
          allowMethods === "POST" &&
          normalizedAllowedHeaders.has("authorization") &&
          normalizedAllowedHeaders.has("content-type") &&
          allowCredentials === null,
        response.status,
        response.status === 204 &&
          allowOrigin === consoleOrigin &&
          allowMethods === "POST" &&
          normalizedAllowedHeaders.has("authorization") &&
          normalizedAllowedHeaders.has("content-type") &&
          allowCredentials === null
          ? "allowed origin received the narrow expected CORS contract"
          : "CORS preflight did not match the expected exact-origin contract",
      ),
    );
  } catch {
    checks.push(
      check(
        "cors_preflight",
        false,
        null,
        "CORS preflight request failed",
      ),
    );
  }

  try {
    const response = await fetchImpl(
      requestUrl(baseUrl, queuePath),
      requestInit(
        {
          method: "GET",
          headers: {
            Origin: consoleOrigin,
          },
        },
        timeoutMs,
      ),
    );
    const body = await safeJson(response);
    const allowOrigin =
      response.headers.get("access-control-allow-origin");

    checks.push(
      check(
        "unauthenticated_browser_rejected",
        response.status === 401 &&
          errorCode(body) === "AUTHENTICATION_REQUIRED" &&
          allowOrigin === consoleOrigin,
        response.status,
        response.status === 401 &&
          errorCode(body) === "AUTHENTICATION_REQUIRED" &&
          allowOrigin === consoleOrigin
          ? "allowed browser origin reached the authentication boundary and failed closed without a token"
          : "unauthenticated browser request did not reach the expected authentication boundary",
      ),
    );
  } catch {
    checks.push(
      check(
        "unauthenticated_browser_rejected",
        false,
        null,
        "unauthenticated browser request failed before a verifiable response",
      ),
    );
  }

  return {
    target: new URL(baseUrl).origin,
    consoleOrigin,
    checkedAt:
      options.now?.() ?? new Date().toISOString(),
    passed: checks.every((item) => item.passed),
    checks,
  };
}
