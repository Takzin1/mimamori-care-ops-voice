# Operations and Observability Baseline

`OperationalCareOpsRuntime` wraps any Care Ops HTTP handler with a small provider-neutral operations boundary.

## Endpoints

### `GET /healthz`

Returns only:

```json
{"status":"ok"}
```

This is a process/liveness signal.

It does not validate external dependencies.

### `GET /readyz`

Runs injected readiness checks.

Returns only:

```json
{"status":"ready"}
```

or:

```json
{"status":"not_ready"}
```

The response deliberately does not disclose:

- check names
- database/provider names
- exception messages
- credentials
- internal topology

HEAD is supported for both endpoints without a response body.

## Request admission

For non-probe Care Ops traffic, `OperationalCareOpsRuntime` can call an injected `CareOpsRequestAdmission` before the application handler.

`OperationalSupabaseCareOpsRuntime` requires this admission controller.

Outcomes:

- allowed -> existing Care Ops handler runs
- denied -> 429 `RATE_LIMITED`
- admission backend error -> 503 `ADMISSION_UNAVAILABLE`
- malformed admission decision -> 503 fail-closed
- optional `Retry-After` -> integer 1..3600 seconds only

`GET|HEAD /healthz` and `GET|HEAD /readyz` bypass admission.

The provider receives the incoming Request only so deployment code can derive a key from platform-trusted ingress context. It must not consume the body and must not log Authorization, resident, Case, or care payloads.

The Core deliberately does not decide whether forwarded-IP headers are trustworthy and does not ship an in-memory limiter as production infrastructure.

A real deployment still needs a shared/edge limiter, explicit thresholds, monitoring, and an abuse-response owner.

## Browser origin policy

Production-facing `OperationalSupabaseCareOpsRuntime` requires an explicit browser origin policy in addition to request admission.

The reference `ExactBrowserOriginPolicy` allows only canonical exact HTTP(S) origins.

Allowed browser responses echo only the exact origin and `Vary: Origin`. Wildcard origins and credentialed CORS are not emitted.

Preflight is limited to GET/POST and Authorization/Content-Type.

Health/readiness probes bypass the browser-origin policy. Requests without Origin proceed as non-browser requests and still require normal admission/authentication.

The deployment must supply the reviewed live Console origin(s).

## Structured logging

The default log schema contains only:

- event
- timestamp
- request ID when available
- route class
- HTTP method
- status
- duration
- readiness boolean/check count for readiness evaluation

It intentionally excludes:

- URL path
- query string
- tenant ID
- Case ID
- subject ID
- principal ID
- actor ID
- request body
- Authorization header
- access token

The default route classes are:

- `health`
- `readiness`
- `care_ops`

## Metrics

The provider-neutral metrics sink receives:

- `care_ops_http_requests_total`
- `care_ops_http_request_duration_ms`

Labels are limited to:

- route class
- method
- status class

Do not add tenant, resident, subject, Case, actor, or principal identifiers as metric labels.

## Failure behavior

Logger/metrics failures are best-effort and do not break Care Ops request handling.

An uncaught application-handler exception becomes a stable 500 response:

```json
{
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "Internal server error",
    "requestId": "..."
  }
}
```

The underlying exception message/stack is not returned by this wrapper.

## Readiness checks

Readiness checks are injected.

Examples a deployment may choose to implement:

- Postgres reachability
- Auth-provider reachability
- mandatory tenant configuration loaded
- required downstream worker dependency reachable

A failed check should return false or throw.

The external readiness response remains generic.

## Supabase composition

Use:

```
createOperationalSupabaseCareOpsRuntime(...)
```

to combine:

- Supabase Auth verification
- membership/RBAC
- Case/Queue runtime
- HTTP API
- health/readiness
- structured logs
- metrics
- required request admission

## Outbox health monitoring

Use `PostgrestOutboxMonitor` for payload-free operational monitoring.

It calls the read-only `get_care_outbox_health` RPC and exposes only:

- status counts
- oldest actionable timestamp
- oldest dead-letter timestamp
- maximum attempt count
- optional delivered count

The projection contains no outbox payload, delivery key, last error, Case ID, subject ID, or resident/care content.

The RPC runs as `SECURITY INVOKER`, so the caller must already hold read access to the outbox table. It does not elevate the runtime role.

See [Outbox and Dead-Letter Operations](outbox-operations.md).

## Resilience runbooks

Operational references:

- [Incident Response](incident-response.md)
- [Backup, Restore, and Rollback](backup-restore-rollback.md)
- [Outbox and Dead-Letter Operations](outbox-operations.md)
- [Deployment Environment Contract](deployment-environment.md)

These documents define the required process, but production owners, alert thresholds, backup provider, RPO/RTO, on-call roster, and drills are still deployment work.

## Still required in production

The repository does not choose an observability vendor.

A deployment still needs:

- log sink
- metrics backend
- alert thresholds
- dashboard
- on-call owner
- dead-letter alerting
- retention policy for operational logs
- incident response process

Do not route resident/care payloads into observability by default.
