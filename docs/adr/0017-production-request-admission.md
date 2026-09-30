# ADR 0017: Production request admission boundary

Status: Accepted

Date: 2026-09-26

## Context

A syntactically valid Care Ops request can trigger trusted server work before a business result is produced:

- identity verification
- tenant membership lookup
- Case / Queue PostgREST reads
- Case mutation RPCs

Outbound dependency timeouts bound the duration of those calls, but they do not bound the number of inbound requests.

A process-local in-memory rate limiter is not a production-safe answer for a horizontally scaled or serverless deployment.

## Decision

Introduce a provider-neutral `CareOpsRequestAdmission` boundary before the authenticated Care Ops handler.

For non-probe traffic:

```
request
  -> request admission
       allowed -> existing authenticated Care Ops handler
       denied  -> 429
       error   -> 503 fail-closed
```

The generic `OperationalCareOpsRuntime` accepts an optional admission implementation so it remains reusable in tests and non-production compositions.

The production-oriented `OperationalSupabaseCareOpsRuntime` requires an admission controller at construction time.

It cannot silently start without one.

## Health / readiness

`GET|HEAD /healthz` and `GET|HEAD /readyz` bypass request admission.

Platform probes therefore continue to operate when the admission backend is rejecting user traffic or is unavailable.

Other requests continue through admission before application/Auth/PostgREST work.

## Denial contract

A denied request returns:

- HTTP 429
- stable `RATE_LIMITED` error code
- safe request ID
- optional bounded `Retry-After`

`Retry-After` is accepted only as an integer from 1 through 3600 seconds.

Malformed decisions fail closed rather than becoming permissive.

## Admission backend failure

If the admission implementation throws, or returns an invalid decision, the runtime returns:

- HTTP 503
- stable `ADMISSION_UNAVAILABLE`
- no backend exception detail

The authenticated Care Ops handler is not called.

## Provider responsibility

This repository defines the boundary, not the production rate-limit vendor.

A production implementation may use:

- edge/platform rate limiting
- API gateway / WAF admission
- Redis or another shared token bucket
- another distributed admission service

The repository intentionally does not ship a process-local Map-based limiter as production-ready infrastructure.

## Request metadata

The admission provider receives the incoming Request because deployment-specific source/key derivation depends on trusted ingress context.

The generic Core does not decide that `X-Forwarded-For` or another client-controlled header is trustworthy.

The provider must:

- use only ingress metadata trusted by the deployment
- not consume the request body
- not log bearer tokens
- not log resident/Case payloads
- not expose backend errors to the caller

## Observability

429 and admission 503 responses pass through the existing generic request completion log / metrics boundary.

Default observability still contains only:

- route class
- method
- status
- duration
- request ID

It does not add rate-limit keys, IPs, tokens, tenant IDs, Case IDs, or request bodies.

## Consequences

- expensive Auth/PostgREST work can be rejected before execution
- production composition fails closed when admission is omitted
- the actual distributed limiter remains deployment-specific and replaceable
- production approval still requires a configured provider, thresholds, trusted key derivation, monitoring, and abuse-response ownership
