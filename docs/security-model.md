# Security Model

## Security objective

A Case represents real operational responsibility. The system must prevent unauthorized users, stale clients, or integration retries from silently changing who owns a Case or whether support is considered complete.

## Trust boundaries

### 1. Signal adapter boundary

Signal adapters are upstream producers.

They may request Case creation, but must not be able to:

- impersonate staff
- complete a Case
- accept a handoff
- rewrite historical evidence

Signal retries are deduplicated by `tenantId + sourceAdapter + sourceSignalId`. Compatible retries converge to the existing Case; mismatched lineage is rejected.

### 2. Authenticated principal boundary

External authentication produces a `principalId`.

The application must not trust actor identity or roles supplied by the client.

```
principalId
  -> TenantMembershipDirectory
  -> active membership
  -> actorId + roles
```

### 3. Application authorization boundary

`CaseService` checks:

- same-tenant active membership
- command permission for role
- assign/handoff target membership

Authorization runs before Case load where possible to reduce existence leakage.

### 4. Pure Core boundary

The Core independently enforces responsibility-sensitive invariants:

- current assignee must start/complete work
- only requested target can accept handoff
- completion requires evidence
- transitions must follow the state machine

### 5. Persistence boundary

Persistence uses:

- `tenantId + caseId`
- expected version
- append-only events
- replay-equivalent snapshot
- Postgres `FOR UPDATE`
- atomic snapshot + event write

### 6. Database access boundary

The reference Supabase/Postgres contract:

- enables RLS
- revokes table access from PUBLIC / anon / authenticated
- keeps runtime service-role table access read-only
- restricts persistence mutation RPC execution to service role
- uses narrowly scoped SECURITY DEFINER mutation RPCs with a locked `pg_catalog` search path

## Threats currently covered by design/tests

| Threat | Mitigation |
|---|---|
| cross-tenant Case lookup | tenant membership + composite persistence key |
| actor spoofing | principal-to-actor binding |
| privilege escalation | command role policy |
| arbitrary assignment | active responder target validation |
| stale overwrite | expectedVersion / CAS |
| double ownership during handoff | outgoing assignee retained until acceptance |
| fake completion | evidence + current-assignee requirement |
| audit history mutation | append-only event contract + runtime direct-DML revoke |
| snapshot drift | replay-equivalence tests |
| hanging trusted dependency call | bounded outbound requests / AbortSignal |
| unbounded inbound Care Ops work | pre-handler request admission + production composition requirement |
| mutable CI compiler resolution | exact TypeScript devDependency + committed integrity lockfile + npm ci |
| browser cross-origin abuse | canonical Origin validation + exact production origin policy + narrow preflight |
| Signal replay / duplicate ingestion | tenant + adapter + source signal uniqueness |

## Threats not yet fully covered

- production identity provider compromise
- production admission provider / threshold / trusted source-key configuration
- production key rotation
- infrastructure compromise
- retention/deletion policy
- backup restoration
- incident response
- privacy/legal controls for real care data

These are production-readiness work, not assumed capabilities.
