# ADR 0011: Browser client and session boundary

Status: Accepted

Date: 2026-09-26

## Context

The server runtime and authenticated HTTP API are ready for a live responder-facing application.

Browser code now needs a transport client.

If that client also owns authentication persistence, refresh behavior, or Supabase database access, the trust boundary would become harder to review and more framework-specific.

## Decision

Add a framework-neutral `CareOpsHttpClient`.

The client depends on an injected `AccessTokenProvider`.

The provider is called for every API operation.

The client never persists or refreshes access tokens.

## Browser transport invariant

The browser client can send:

- tenant ID
- Case ID
- expected Case version
- business command intent
- bearer access token in the Authorization header

It cannot configure or send:

- service-role credentials
- trusted principal ID
- trusted actor ID
- tenant membership roles

## Command defense in depth

Commands are rebuilt from their allowed fields before serialization.

Unknown runtime properties are discarded even if a caller bypasses static TypeScript checks.

Server-side strict parsing remains authoritative.

## Fetch behavior

The client forces:

- no credential cookies
- no cache
- redirect rejection
- no referrer

This reduces accidental token or session propagation outside the intended API request.

## Error boundary

Only a valid Care Ops JSON error envelope becomes a structured client error.

Malformed/non-JSON responses fail closed as protocol errors.

## Session responsibility

Login, refresh, token rotation, revocation response, and sign-out belong to a later session shell.

That shell may use Supabase Auth or another provider, but it supplies only a fresh bearer token to this client.

## Consequences

- browser transport remains provider-neutral
- service-role concepts do not enter browser configuration
- session persistence can be reviewed independently
- Console components can depend on a small Care Ops client contract
