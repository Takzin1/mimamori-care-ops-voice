# ADR 0010: Server-only runtime composition root

Status: Accepted

Date: 2026-09-26

## Context

The Care Ops package now has independent adapters for:

- Supabase Auth verification
- persistent tenant membership
- PostgREST Case persistence
- SLA policy lookup
- application services
- authenticated HTTP transport

Without one composition root, every deployment could wire these layers differently and accidentally bypass a security boundary.

## Decision

Provide a reference server-only composition root:

```text
SupabaseCareOpsRuntime
  -> CareOpsHttpApi
  -> AuthenticatedCareOpsGateway
  -> Auth + membership + application services
  -> PostgREST persistence
```

The runtime's public surface is only:

```text
handle(Request) -> Response
```

Secret-bearing internal adapters are not returned.

## Explicit configuration

The runtime accepts explicit server configuration:

- Supabase URL
- publishable key
- service-role key
- tenant SLA policies
- optional fetch implementation
- optional repository page size
- optional command body limit
- optional request ID factory
- optional clock

The Core package does not read environment variables.

## Credential separation

The user bearer token flows only through `SupabaseAuthAuthenticator`.

The service-role key flows only through server-side PostgREST adapters.

Publishable and service-role credentials must be distinct.

## SLA configuration

At least one SLA policy is required at runtime construction.

A deployment that cannot resolve tenant SLA policy fails at the existing application boundary rather than silently applying an implicit default.

## Framework independence

The runtime uses Web `Request` / `Response` and raw fetch-compatible adapters.

It introduces no Next.js, Vercel, Express, Fastify, or Supabase SDK dependency.

A framework adapter should remain a thin wrapper over `runtime.handle(request)`.

## Consequences

- deployment wiring becomes deterministic and reviewable
- framework code cannot easily bypass identity/membership composition
- service-role-bearing internals are not part of the runtime public API
- credential-routing behavior can be regression-tested with one fake fetch boundary
- production secret loading remains deployment-owned
