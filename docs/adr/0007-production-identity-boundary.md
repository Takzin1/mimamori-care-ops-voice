# ADR 0007: Production identity boundary and tenant membership

Status: Accepted

Date: 2026-09-26

## Context

The Care Ops application layer already authorizes:

```
tenantId + principalId
  -> TenantMembership
  -> actorId + roles + active
```

That model is safe only if `principalId` comes from a trusted identity verifier.

A production HTTP client must never be allowed to choose its own `principalId`.

Authentication also does not answer which tenant the principal belongs to or which Care Ops role they hold.

## Decision

Production human requests pass through:

```
access token
  -> PrincipalAuthenticator
  -> verified principalId
  -> TenantMembershipDirectory
  -> Case / Queue authorization
```

The provider-neutral boundary is `PrincipalAuthenticator`.

Supabase Auth is the first reference provider.

## Authentication vs authorization

Authentication proves the external identity:

```
access token -> verified auth user id
```

Care Ops authorization remains separate:

```
tenantId + verified auth user id
  -> persistent membership
  -> actorId + Care Ops roles
```

A valid Supabase user with no active membership in the requested tenant receives no Case access.

## Metadata rule

Care Ops roles are **not** read from:

- browser request bodies
- user-editable `user_metadata`
- client-side session objects
- arbitrary JWT metadata supplied by the client

The reference Supabase verifier returns only the verified Auth user ID as `principalId`.

The tenant membership store is the authority for Care Ops actor identity and roles.

## Server boundary

`AuthenticatedCareOpsGateway` accepts:

- access token
- tenant ID
- Case ID / command where applicable

It does not accept `principalId`.

The gateway authenticates first, then injects the verified principal into `CaseService` or `CaseQueueService`.

An authentication failure occurs before membership, Queue, or Case lookup.

## Membership persistence

`care_tenant_memberships` is keyed by:

```
tenant_id + principal_id
```

and has a unique same-tenant actor identity:

```
tenant_id + actor_id
```

Allowed roles are:

- dispatcher
- responder
- supervisor
- auditor

Runtime membership lookup is server-side service-role read-only.

Provisioning/mutation is intentionally a separate administrative concern.

## Supabase reference verifier

The reference adapter verifies the access token through the Supabase Auth user endpoint and uses the returned Auth user `id`.

The publishable key may identify the Supabase project, but the service-role key remains server-only and is not used for browser authentication.

## Consequences

- callers cannot impersonate another Care Ops principal by request-body substitution
- authentication and tenant authorization remain independently testable
- changing identity provider does not change the Case Core
- Care Ops roles remain auditable business configuration
- live Console wiring can now use a trusted server identity boundary
