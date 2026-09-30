# ADR 0009: Authenticated HTTP boundary

Status: Accepted

Date: 2026-09-26

## Context

Care Operations now has:

- a pure Case state machine
- tenant-scoped persistence
- operational RBAC
- verified production identity boundary
- persistent tenant membership
- audited membership lifecycle
- Case Queue / SLA projections
- a synthetic Responder Console

A live responder UI still needs a network transport.

The transport must not become a second authorization system or allow the browser to choose trusted identity.

## Decision

Add a thin Web-standard HTTP boundary:

```text
Request
  -> CareOpsHttpApi
  -> AuthenticatedCareOpsGateway
  -> existing application/domain layers
```

The HTTP module uses only standard `Request` and `Response`.

## Route contract

```text
GET  /api/care-ops/tenants/:tenantId/queue
GET  /api/care-ops/tenants/:tenantId/cases/:caseId
GET  /api/care-ops/tenants/:tenantId/cases/:caseId/metrics
POST /api/care-ops/tenants/:tenantId/cases/:caseId/commands
```

Signal ingestion is not exposed through this responder-facing API.

## Identity invariant

The HTTP layer accepts a Bearer access token.

It does not accept a trusted principal ID.

```text
Authorization: Bearer <token>
  -> AuthenticatedCareOpsGateway
  -> PrincipalAuthenticator
  -> verified principalId
  -> TenantMembershipDirectory
  -> actorId + Care Ops roles
```

The command body cannot supply `principalId`, `actorId`, or roles.

Strict unknown-field rejection makes identity injection a transport error before authentication or mutation.

## Tenant disclosure invariant

Cross-tenant Case access is denied by membership before the repository discloses whether a Case ID exists.

An unauthorized existing Case and an unauthorized missing Case therefore share the same 403 contract.

## Command invariant

The HTTP body expresses only business intent plus `expectedVersion`.

Trusted actor identity is bound by the application service from verified membership.

## Error boundary

Transport errors are mapped to stable HTTP contracts.

Database/internal error messages are never returned to the client.

Integrity/corruption errors are treated as internal failures, not ordinary availability responses.

## Request and response safety

The boundary enforces:

- safe route identifiers
- strict Bearer syntax
- JSON content type for commands
- actual streamed body byte limit
- exact command fields
- no-store responses
- request IDs
- no permissive CORS headers

## Framework boundary

The module has no Express, Fastify, Next.js, Vercel, Supabase SDK, or browser dependency.

A framework-specific route adapter may be added later without changing the HTTP/domain contract.

## Consequences

- live Console transport can be added without moving trust into the browser
- identity remains provider-replaceable
- tenant authorization remains in one application policy path
- Case lifecycle logic remains in the Core
- service-role credentials remain server-only
- the synthetic Console can later be replaced or complemented by an authenticated live shell
