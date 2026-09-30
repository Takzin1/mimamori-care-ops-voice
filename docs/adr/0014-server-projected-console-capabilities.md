# ADR 0014: Server-projected Console capabilities

Status: Accepted

Date: 2026-09-26

## Context

A live Responder Console needs to know:

- who the current operator is in Care Ops terms
- whether their Queue is tenant-wide or responder-only
- which Case actions should be offered now

If the browser derives those answers independently from roles and Case status, RBAC and lifecycle logic would be duplicated outside the trusted application boundary.

That would create drift between:

- what the UI appears to allow
- what the server actually allows

## Decision

Project safe operator context and Case command capabilities from the trusted server.

The projection combines:

```
shared Case Core structural command precondition
+ shared tenant membership RBAC policy
-> visible command capability
```

The browser renders the projection instead of maintaining a second lifecycle/RBAC table.

## Shared structural precondition

`executeCommand()` and capability projection use the same read-only structural command precondition.

It covers:

- Case status
- current assignee ownership
- handoff target ownership
- outgoing assignee presence for handoff acceptance

Parameter-specific validation remains at execution time.

For example:

- a priority-change capability may be visible, but selecting the current priority is still rejected
- assign/handoff capability may be visible, but the target must still be an active assignable member
- completion capability may be visible, but outcome/summary/evidence must still be valid

## Shared RBAC policy

Command capability projection and `assertCanExecuteCommand()` use the same role map.

An auditor therefore receives no mutation command capabilities even when lifecycle state would otherwise permit an action.

## Operator projection

The safe operator projection includes:

- tenant ID
- Care Ops actor ID
- Care Ops roles
- Queue visibility: tenant or responder

It excludes:

- principal ID
- Auth-provider user metadata
- bearer token
- service-role credentials

## HTTP routes

The authenticated API exposes:

```
GET /api/care-ops/tenants/:tenantId/operator
GET /api/care-ops/tenants/:tenantId/cases/:caseId/capabilities
```

Both routes bind identity through the existing verified bearer -> principal -> membership path.

## Capability payload

A Case capability payload contains:

- Case ID
- Case version
- Case status
- safe operator projection
- allowed command types
- input requirements for each command

Input requirements are descriptive UI metadata, not permission bypasses.

## Browser and workspace

`CareOpsHttpClient` and `CareOpsSessionController` expose the new read paths.

`LiveConsoleWorkspace` loads:

- operator context with Queue initialization
- capabilities with selected Case detail/metrics
- refreshed capabilities after mutation or conflict refetch

## Consequences

- renderer code does not reproduce RBAC
- renderer code does not reproduce Case lifecycle availability
- ownership-sensitive buttons follow the same rules as execution
- UI capability drift becomes testable
- command execution remains authoritative even when a capability was previously shown
