# ADR 0013: Live Console workspace state model

Status: Accepted

Date: 2026-09-26

## Context

The trusted Care Operations path now reaches the browser through:

```
server runtime
-> authenticated HTTP API
-> browser-safe client
-> ephemeral session controller
```

A live Responder Console still needs application state for Queue, selected Case, metrics, command progress, and optimistic-version conflict handling.

Putting this behavior directly inside React/Next.js components would duplicate operational rules and make concurrency behavior hard to test.

## Decision

Add a renderer-neutral `LiveConsoleWorkspace`.

A future UI framework binds to its snapshot and methods.

The workspace depends only on `CareOpsSessionClient`.

It does not know about:

- Supabase SDKs
- access tokens
- service-role credentials
- principal IDs
- actor IDs
- PostgREST
- Case persistence internals

## Queue rule

The workspace renders the authorized Queue exactly as returned by the server-side Queue projection.

It does not implement its own:

- SLA ranking
- priority ranking
- tenant visibility
- responder visibility
- attention reason calculation

## Selection rule

Selecting a Case triggers parallel detail and metrics requests.

Selection requests are generation-scoped.

A response for an older selection cannot overwrite a newer selected Case.

## Mutation rule

A Case command uses the version from the currently loaded Case aggregate.

Only one workspace mutation may be pending at a time.

After a successful command:

1. the returned aggregate/version becomes immediately visible
2. the Queue is refreshed
3. the selected Case/detail/metrics are refreshed from the server

## Stale-write rule

HTTP 409 is not automatically retried.

The workspace:

1. records a stale conflict
2. records expected/current versions when available
3. refreshes the Queue
4. refetches the latest selected Case and metrics
5. requires the operator to decide and submit again

This preserves human intent and optimistic-concurrency visibility.

## Authorization/business errors

HTTP 403 and 422 are retained as operator-visible errors.

They do not clear the authenticated session.

## Session loss

If the session becomes:

- signed_out
- reauthentication_required

the workspace invalidates in-flight Queue/detail/mutation generations and clears operational data from render state.

Late responses cannot repopulate the workspace after session loss.

## Historical detail

A selected Case may remain visible after it leaves the active Queue.

The workspace marks whether the selected Case is still active instead of automatically discarding detail.

This supports the transition from active handling to evidence/history review.

## Snapshot safety

Render snapshots contain:

- safe session status
- Queue projection
- selected Case and metrics
- safe error envelopes
- mutation/conflict state
- refresh metadata

They contain no bearer token, Auth provider object, service-role key, trusted principal, or database credential.

## Consequences

- UI framework code stays thin
- Case/SLA business logic remains server/domain-owned
- selection races are deterministic
- stale commands cannot be silently replayed
- session loss cannot leave operational data rendered by late async responses
- React/Next.js or another renderer can be added without redefining Care Ops behavior
