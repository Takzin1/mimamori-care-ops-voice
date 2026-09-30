# Live Responder Console Workspace

`LiveConsoleWorkspace` is the renderer-neutral application model for a live GK / Last-mile operator console.

## Boundary

```text
React / Next.js / other renderer
  -> LiveConsoleWorkspace
       -> CareOpsSessionClient
  -> authenticated Care Ops HTTP API
```

The workspace is not an authentication provider and is not a database client.

## Snapshot

The render snapshot contains:

- tenant ID
- safe session state
- Queue load/data/error state
- selected Case ID
- whether that Case remains in the active Queue
- Case detail load/data/error state
- metrics load/data/error state
- command pending/error state
- stale-version conflict metadata
- last successful refresh timestamp
- generation for deterministic renderer updates

## Queue flow

`initialize()` initializes the session and, when ready, loads the authorized Queue.

`refreshQueue()` preserves old Queue data while loading and replaces it only with the latest request generation.

Queue ordering is never recomputed in the workspace.

## Case selection

`selectCase(caseId)` loads:

- current Case snapshot + event history
- TTC/supporting metrics

in parallel.

If the operator selects Case B while Case A is still loading, late A responses are discarded.

## Commands

`execute(command)` sends:

- tenant ID
- selected Case ID
- current aggregate version
- business command intent

through the existing session/client boundary.

The workspace never supplies trusted actor identity.

## Successful mutation

After a successful command:

- returned aggregate/version is displayed immediately
- Queue refreshes
- selected Case and metrics refresh from the canonical server state

## 409 conflict

A stale command is **not** retried automatically.

The workspace stores:

```text
expectedVersion
actualVersion
```

when available, then refetches current Queue/detail.

The operator must intentionally submit a new command after reviewing the refreshed state.

## 403 / 422

Authorization denial and lifecycle rejection remain visible workspace errors.

They do not become authentication failures.

## Session loss

When the session leaves `ready`:

- Queue is cleared
- selected Case is cleared
- detail/metrics are cleared
- mutation state is cleared
- in-flight request generations are invalidated

This prevents late responses from repopulating sensitive operational state.

## Historical Case detail

If a selected Case is completed/closed and disappears from the active Queue, its loaded detail may remain visible.

`selectedCaseActive=false` tells the renderer that it is now historical/detail-only.

## Renderer responsibility

A future framework shell should primarily:

- render workspace snapshots
- call workspace methods from explicit operator actions
- render login/reauth states from session snapshot
- avoid implementing Case transition/SLA/authorization logic itself


## Operator and capabilities

Workspace initialization loads safe operator context alongside the Queue.

Selecting a Case loads capabilities alongside detail and metrics.

Capabilities are refreshed after accepted commands and stale-conflict refetches.

The renderer should use these server projections to decide which controls and input forms to show instead of reimplementing RBAC or lifecycle availability.
