# Incident Response Runbook

This runbook defines the minimum Care Ops response process before production PII/care data is allowed.

It does not replace an organization-wide incident policy.

## Severity triggers

Treat these as urgent security/operations incidents:

- suspected service-role/admin credential exposure
- cross-tenant Case access
- unauthorized Case mutation
- membership privilege escalation
- audit/event history inconsistency
- unexplained outbox delivery or replay
- production admission/origin control bypass
- real personal/care data appearing in logs, CI, screenshots, or demo systems

Availability incidents include:

- Auth/PostgREST/admission dependency outage
- sustained 5xx/503
- dead-letter accumulation
- worker lease stalls
- restore/rollback failure

## First 15 minutes

1. assign an incident owner
2. record detection time and affected environment
3. stop expanding the blast radius
4. preserve evidence before destructive remediation
5. identify which trust boundary is affected
6. explicitly decide whether production writes/delivery must be paused

Do not paste resident/care payloads into chat, public issues, or generic incident channels.

## Credential compromise

If a credential may be exposed:

1. revoke/rotate the affected credential
2. do not reuse the old value
3. identify all components that received it
4. inspect Git history, CI logs, deployment logs, screenshots, and environment configuration
5. rotate downstream credentials if trust cannot be established
6. verify the old credential fails
7. verify the replacement has minimum privileges

Credential classes must be handled separately:

- browser/publishable configuration
- runtime service-role credential
- membership-admin credential
- outbox worker/delivery credential
- observability credential

## Access-control incident

For cross-tenant or unauthorized Case access:

1. disable affected principal/membership where appropriate
2. preserve relevant membership audit events
3. capture request IDs and timestamps
4. determine whether the event was read, mutation, or both
5. test the same path with a synthetic principal
6. patch the authorization boundary
7. add regression coverage before re-enabling access

Do not delete membership/audit history as containment.

## Audit-integrity incident

If snapshot/event/membership audit state appears inconsistent:

1. pause affected mutation path
2. do not edit historical events directly
3. export evidence using restricted administrative tooling
4. replay Case events and membership audit history
5. compare replayed state with current snapshot
6. restore from a known-good backup only after scope is understood
7. document any logical corrective event separately

## Outbox / delivery incident

If dead letters or duplicate external effects are suspected:

1. pause the affected delivery handler if duplication risk exists
2. inspect payload-free outbox health first
3. identify affected delivery keys using restricted operational access
4. verify provider-side idempotency behavior
5. do not bulk requeue blindly
6. replay only after an explicit operator decision
7. record which delivery keys were retried and why

## Dependency outage

For Auth/PostgREST/admission degradation:

- prefer fail-closed behavior over bypassing security controls
- keep health/readiness semantics accurate
- do not disable admission/origin/auth controls to restore availability
- communicate degraded capabilities to operators
- verify backlog/outbox state after recovery

## Evidence to preserve

Preserve, with access control:

- incident timeline
- request IDs
- affected commit/deployment IDs
- membership audit versions
- Case/event sequence numbers
- outbox IDs/delivery keys where operationally required
- credential rotation timestamps
- relevant configuration diffs

Avoid duplicating sensitive payloads.

## Recovery gate

Before declaring recovered:

- root cause or containment is understood
- compromised credentials are revoked
- relevant regression test exists/passes
- CI is green
- deployed health/readiness is green
- audit replay is consistent
- dead-letter/backlog state is understood
- operator-facing impact is documented

## Post-incident review

Record:

- impact
- detection gap
- containment time
- root cause
- corrective action
- missing monitoring
- whether release checklist/runbooks must change

Production must assign a named on-call/incident owner before real care data is permitted.
