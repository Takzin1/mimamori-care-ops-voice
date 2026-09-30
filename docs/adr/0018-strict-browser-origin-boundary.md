# ADR 0018: Strict browser origin boundary

Status: Accepted

Date: 2026-09-27

## Context

The Care Ops HTTP API intentionally emitted no permissive CORS headers.

A live Console deployment still needs an explicit browser-origin contract so a deployment does not accidentally add wildcard or overly broad CORS behavior around the trusted API.

## Decision

Add a provider-neutral browser origin policy before request admission, authentication, or PostgREST work.

Production-oriented `OperationalSupabaseCareOpsRuntime` requires an explicit origin policy.

## Origin validation

Only canonical HTTP(S) origins are accepted.

Rejected before policy evaluation:

- `null`
- `*`
- malformed URLs
- credentials in the origin
- path/query/fragment content
- non-http(s) schemes
- non-canonical serialization

The provided `ExactBrowserOriginPolicy` performs exact serialized-origin matching.

Sibling/subdomain matching is never implicit.

## Requests without Origin

Requests without an `Origin` header may continue to request admission and authentication.

The origin boundary is a browser cross-origin control, not a substitute for service authentication.

## Allowed browser request

For an allowed origin, the response includes:

- `Access-Control-Allow-Origin: <exact allowed origin>`
- `Vary: Origin`

The runtime does not emit `Access-Control-Allow-Credentials`.

This remains compatible with the Care Ops browser client, which sends an explicit Bearer token and omits ambient credentials.

## Preflight

For Care Ops API paths only, preflight accepts:

Methods:

- GET
- POST

Request headers:

- Authorization
- Content-Type

Anything else is rejected.

Allowed preflight responses include a bounded 600-second max age.

Preflight bypasses request admission and the application handler after the browser origin is accepted.

## Order of trust boundaries

```
health/readiness probe
  -> bypass browser origin policy

Care Ops browser request
  -> canonical Origin validation
  -> origin policy
  -> request admission
  -> authentication
  -> membership / RBAC
  -> Case operation
```

A denied origin cannot consume Auth/PostgREST work.

## Failure behavior

- disallowed/malformed origin -> 403 `ORIGIN_NOT_ALLOWED`
- origin policy failure -> 503 `ORIGIN_POLICY_UNAVAILABLE`
- disallowed preflight -> 403 `CORS_PREFLIGHT_REJECTED`

No internal policy exception detail is returned.

## Consequences

- wildcard CORS cannot be introduced through the reference production composition
- browser origin rejection happens before rate-limit/Auth/PostgREST work
- the actual production Console origin remains a deployment choice
- deployment review must verify the configured exact origin list
