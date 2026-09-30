# Care Operations HTTP API

This API is the thin server transport for a future live Responder Console.

It does not own Case lifecycle rules, tenant authorization, or identity verification.

Those remain in:

```text
CareOpsHttpApi
  -> AuthenticatedCareOpsGateway
  -> PrincipalAuthenticator
  -> TenantMembershipDirectory
  -> CaseQueueService / CaseService
  -> CaseRepository
```

## Routes

### Operational Queue

```http
GET /api/care-ops/tenants/{tenantId}/queue
Authorization: Bearer <access-token>
```

Returns the authorized Case Queue projection.

### Case detail

```http
GET /api/care-ops/tenants/{tenantId}/cases/{caseId}
Authorization: Bearer <access-token>
```

Returns the current Case snapshot and append-only event history.

Successful responses include `X-Case-Version`.

### Case metrics

```http
GET /api/care-ops/tenants/{tenantId}/cases/{caseId}/metrics
Authorization: Bearer <access-token>
```

Returns TTC and supporting Case metrics.

### Execute Case command

```http
POST /api/care-ops/tenants/{tenantId}/cases/{caseId}/commands
Authorization: Bearer <access-token>
Content-Type: application/json
```

Example:

```json
{
  "expectedVersion": 3,
  "command": {
    "type": "start_action"
  }
}
```

The body must never contain trusted identity fields.

Unknown fields are rejected.

## Authentication

The HTTP layer only extracts a syntactically valid Bearer token.

It never creates a principal ID.

The token is passed to `AuthenticatedCareOpsGateway`, which invokes the configured `PrincipalAuthenticator`.

The reference production identity path is:

```text
Bearer access token
  -> SupabaseAuthAuthenticator
  -> verified Auth user ID
  -> tenant membership
  -> Care Ops actor ID + roles
```

Do not trust:

- `principalId` from JSON
- `actorId` from JSON
- user-editable Auth metadata
- service-role credentials from a client

## Supported command shapes

```json
{ "type": "acknowledge" }
{ "type": "set_priority", "priority": "critical" }
{ "type": "assign", "assigneeId": "responder-a" }
{ "type": "start_action" }
{ "type": "request_handoff", "targetAssigneeId": "responder-b" }
{ "type": "accept_handoff" }
{
  "type": "complete",
  "outcome": "confirmed_safe",
  "summary": "Synthetic confirmation",
  "evidence": [
    { "kind": "call", "ref": "synthetic:call:001" }
  ]
}
{ "type": "close" }
{ "type": "reopen", "reason": "Synthetic follow-up required" }
```

## Error contract

Errors use a stable, safe envelope:

```json
{
  "error": {
    "code": "STABLE_CODE",
    "message": "Safe message",
    "requestId": "server-generated-id"
  }
}
```

Representative mappings:

| HTTP | Meaning |
|---:|---|
| 400 | invalid path / JSON / command schema |
| 401 | missing, malformed, invalid, or expired identity |
| 403 | tenant membership or command authorization denied |
| 404 | authorized tenant, Case or route absent |
| 409 | stale optimistic Case version |
| 413 | command body exceeded byte limit |
| 415 | command request is not JSON |
| 422 | syntactically valid but forbidden Case lifecycle transition |
| 503 | storage transport or tenant SLA dependency unavailable |
| 500 | unexpected or integrity/corruption failure |

Internal database messages and tenant/Case identifiers are not returned in error messages.

## Concurrency

Commands require `expectedVersion`.

The authoritative compare-and-set remains in the Case repository/database.

A stale write returns HTTP 409 with only:

- expected version
- current version

## Request safety

Command requests use:

- exact route parsing
- bounded safe path identifiers
- strict Bearer syntax
- `Content-Type: application/json`
- bounded body bytes
- strict JSON schema
- unknown-field rejection

The default command body limit is 32 KiB.

## Response safety

Every response includes:

- `Cache-Control: no-store`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer`
- `Vary: Authorization`
- server-generated `X-Request-Id`

The transport emits no permissive CORS header.

Origin policy belongs to the deployment edge and must be reviewed before a live Console is exposed.

## Framework boundary

The module uses standard Web `Request` / `Response` only.

A deployment may wrap it with:

- Next.js Route Handler
- Vercel Function
- Node HTTP adapter

The browser must never instantiate a database repository or receive a service-role key.


## Operator and Case capability reads

The authenticated API also exposes safe UI projections:

```
GET /api/care-ops/tenants/:tenantId/operator
GET /api/care-ops/tenants/:tenantId/cases/:caseId/capabilities
```

The operator route returns Care Ops actor ID, roles, and Queue visibility, but never the verified Auth principal ID.

The capability route combines the current Case structural preconditions with the same RBAC role map used by command execution. It is advisory/read-only; actual commands remain subject to current identity, membership, target validation, expected version, and Case transition validation.
