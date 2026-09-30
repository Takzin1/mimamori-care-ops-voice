# Deployment Environment Contract

This document defines credential/configuration separation expected before production.

## Browser / Console

May receive only public/browser-safe configuration, such as:

- Care Ops API base URL
- Supabase publishable/public client configuration
- exact Console origin

Must never receive:

- Supabase service-role key
- membership-admin credential
- outbox worker/provider secret
- observability ingestion/admin secret

## Care Ops API runtime

Server-only.

Owns:

- runtime service-role credential
- Auth verification configuration
- tenant SLA policy configuration
- request-admission adapter
- exact browser-origin policy
- observability sink credentials if needed

The runtime service-role credential is not a membership-admin credential.

## Membership administration

Separate control-plane credential/identity.

Must not be shipped to:

- browser
- ordinary Care Ops API runtime
- reviewer demo
- outbox delivery worker unless explicitly required and reviewed

Changes must remain versioned/audited.

See `membership-admin-runbook.md`.

## Outbox worker

Server-only.

Should have a worker-specific operational identity/credential path where the deployment supports it.

External provider credentials belong here, not in the browser/API response surface.

Worker logs must remain payload-minimal.

## Observability

Prefer write-only ingestion credentials for application telemetry.

Observability configuration must not cause request bodies, bearer tokens, Case payloads, or resident identifiers to be copied by default.

## Synthetic reviewer demo

The reviewer demo is isolated from production.

It requires:

- no Supabase service-role key
- no production Auth secret
- no resident/care data
- no production API dependency

Its deployment is tracked separately in Issue #22.

## Environment separation

At minimum distinguish:

- local development
- CI
- synthetic reviewer demo
- staging/integration
- production

Do not reuse production secrets in CI or reviewer demo.

## Secret rotation evidence

Before production:

- identify owner for each credential class
- document rotation/revocation mechanism
- perform a synthetic rotation where practical
- verify old credential fails
- verify replacement works
- record dependent components that require restart/redeploy

## Production configuration record

Maintain a restricted inventory of:

- environment
- deployment/project IDs
- data region
- Auth project
- database project
- exact allowed Console origin(s)
- request-admission provider
- log/metrics provider
- backup provider
- credential owners
- on-call/incident owner

Do not place secret values in this inventory.


## Care Ops API runtime environment contract

The repository provides:

- `parseCareOpsDeploymentEnvironment(...)`
- `createCareOpsDeployment(...)`

The parser is provider-neutral and consumes a string environment map. The composition root then builds the existing `OperationalSupabaseCareOpsRuntime`; deployment adapters must not instantiate the database repository directly.

Required API runtime variables:

| Variable | Meaning |
|---|---|
| `CARE_OPS_ENVIRONMENT` | exactly `staging` or `production` |
| `SUPABASE_URL` | HTTPS Supabase project URL |
| `SUPABASE_PUBLISHABLE_KEY` | browser/Auth API key; user JWT remains in `Authorization` |
| `SUPABASE_SECRET_KEY` | preferred server-only `sb_secret_...` credential |
| `CARE_OPS_CONSOLE_ORIGINS` | comma-separated canonical exact Console origins |
| `CARE_OPS_SLA_POLICIES_JSON` | tenant -> priority SLA policy JSON |

Legacy compatibility fallback:

| Variable | Meaning |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | legacy JWT-based server credential; used only when `SUPABASE_SECRET_KEY` is absent |

When `SUPABASE_SECRET_KEY` is present, it takes precedence and is sent only as the `apikey` header. It must never be placed in `Authorization: Bearer`. The legacy service-role fallback retains Bearer behavior for compatibility.

Optional bounded values:

| Variable | Default | Bounds |
|---|---:|---:|
| `CARE_OPS_OUTBOUND_TIMEOUT_MS` | 5000 | 100..60000 |
| `CARE_OPS_MAX_COMMAND_BODY_BYTES` | 32768 | 1024..1048576 |

The parser rejects:

- non-HTTPS Supabase URLs in staging/production
- Supabase URLs containing credentials/query/fragment
- equal publishable and service-role keys
- wildcard/non-canonical/path-bearing Console origins
- duplicate Console origins
- malformed or incomplete SLA policy JSON
- out-of-range timeout/body limits

### Secret-class separation

These secret classes must **not** be present in the Care Ops API runtime environment:

- `CARE_OPS_MEMBERSHIP_ADMIN_SECRET`
- `CARE_OPS_OUTBOX_PROVIDER_SECRET`
- `CARE_OPS_BACKUP_OPERATOR_SECRET`

Their presence causes deployment configuration parsing to fail closed.

This is deliberate: the ordinary Care Ops API runtime must not silently become the membership-administration, external-delivery, or backup-operator control plane.

The environment parser never logs secret values and validation errors must not echo them.

### Pre-deployment config doctor

Before deploying a staging/production API runtime, validate the provider environment **without making network requests**:

```bash
npm run config:validate
```

The command reads only `process.env`, runs the same fail-closed deployment parser, and emits a deliberately secret-safe summary containing only:

- environment stage
- Supabase host
- Console origin count
- tenant SLA policy count
- effective outbound timeout
- effective command body limit

It never prints publishable/service-role key values. A tracked `.env.example` documents the variable names while leaving credential values blank.

A successful config-doctor result proves only that the repository's configuration contract is satisfied; it does not prove that credentials work, that the deployed database has correct grants/RLS, or that the environment is operational.

### Deployment adapter rule

A framework/provider adapter should do only this:

```text
provider env
  -> parseCareOpsDeploymentEnvironment
  -> createCareOpsDeployment
  -> OperationalSupabaseCareOpsRuntime.handle(Request)
```

The adapter must inject a real shared/edge `CareOpsRequestAdmission`, and may inject logger, metrics, readiness checks, and fetch transport.

It must not:

- instantiate `PostgrestCaseRepository` in a browser/client bundle
- bypass the authenticated gateway
- bypass the origin/admission boundaries
- inject membership-admin/provider/backup secrets into the API runtime
- downgrade staging/production Supabase transport to HTTP
