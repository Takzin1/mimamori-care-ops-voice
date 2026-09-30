# ADR 0003: Tenant staff command authorization

Status: Accepted

Date: 2026-09-25

## Context

Tenant-scoped storage prevents cross-organization data collisions, but storage isolation alone does not answer:

- whether the authenticated caller is staff of the tenant
- which operational role they hold
- whether they may execute a specific Case command
- whether an assignment or handoff target is an active responder
- which actor identity should be written to the audit event

Allowing clients to submit `actorId` directly would make audit identity spoofable.

## Decision

Authenticated principals are resolved through a trusted `TenantMembershipDirectory`.

A membership binds:

```
tenantId
+ principalId
-> actorId
+ roles
+ active
```

Application commands never accept `actorId` from the caller. `CaseService` binds the actor from trusted membership before calling the pure Core.

## Role policy

| Command | dispatcher | responder | supervisor | auditor |
|---|---:|---:|---:|---:|
| set_priority | yes | no | yes | no |
| acknowledge | yes | no | yes | no |
| assign | yes | no | yes | no |
| start_action | no | yes | yes | no |
| request_handoff | no | yes | yes | no |
| accept_handoff | no | yes | yes | no |
| complete | no | yes | yes | no |
| close | yes | no | yes | no |
| reopen | no | no | yes | no |
| read / metrics | yes | assigned / handoff target only | yes | yes |

Assignment and handoff targets must be active staff with `responder` or `supervisor` role.

Responder visibility is Case-scoped. A responder may read a Case only while they are the current `assigneeId` or current `handoffTargetId`. Dispatcher, supervisor, and auditor roles retain tenant-wide read visibility.

Because the current lifecycle acknowledges a Case before assignment, responders do not acknowledge unassigned NEW Cases.

## Security ordering

Authorization occurs before Case load for command and read paths.

This prevents an unauthorized principal from using response differences to discover whether a Case exists inside another tenant.

## Consequences

- audit `actorId` is derived from trusted membership
- inactive memberships fail closed
- auditors are read-only
- target staff cannot be arbitrary strings
- authorization remains outside the pure Case state machine
