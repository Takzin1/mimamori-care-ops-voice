# ADR 0008: Audited membership control plane

Status: Accepted

Date: 2026-09-26

## Context

Production identity can verify a principal and resolve an existing tenant membership.

That is insufficient for production operations unless staff provisioning, role changes, transfers, and revocation are themselves controlled and auditable.

A normal Care Ops `supervisor` is an operational role. It must not automatically become an account-provisioning administrator.

The runtime `service_role` is intentionally membership read-only and must remain so.

## Decision

Membership lifecycle changes use a separate control plane:

```
trusted membership administrator
  -> MembershipAdminService
  -> expectedVersion
  -> membership transition
  -> atomic snapshot update
  + append-only audit event
```

The control plane is distinct from the human Case/Queue request path.

## Membership lifecycle

Supported changes are explicit commands:

- create membership
- replace roles
- activate
- deactivate
- change actor ID

Memberships are not deleted during normal lifecycle operations.

Departure, transfer, suspension, or access removal is represented by `deactivate`, preserving identity and audit history.

## Versioning

Each membership snapshot has a monotonically increasing `version`.

Every accepted administrative change increments the version by exactly one.

Stale administrative writes are rejected instead of overwriting newer staff-access state.

## One change per version

One membership version may change exactly one of:

- roles
- active state
- actor ID

This makes each audit event mechanically explainable and prevents one update from hiding multiple access-control decisions.

## Audit requirements

Every membership mutation requires:

- administrative actor ID
- reason
- timestamp
- resulting version

The audit event is append-only and keyed by:

```
tenantId + principalId + version
```

The database trigger writes the audit event in the same transaction as the snapshot mutation.

If the audit insert fails, the membership snapshot change rolls back.

## Runtime credential separation

`service_role`:

- may SELECT membership snapshots
- may SELECT membership audit events
- may not INSERT / UPDATE / DELETE memberships
- may not INSERT / UPDATE / DELETE membership audit events
- may not execute membership mutation functions

`care_membership_admin`:

- is a separate NOLOGIN database role
- is not granted to runtime service credentials
- may execute the private administrative functions
- is subject to membership RLS policies
- cannot DELETE memberships
- cannot INSERT audit events directly

## Database enforcement

The database enforces:

- non-empty constrained Care Ops roles
- tenant/principal primary identity
- tenant/actor uniqueness
- version increment by exactly one
- identity immutability
- one changed field per version
- mandatory admin actor/reason/timestamp context
- delete rejection
- automatic audit insertion

The administrative SQL functions are `SECURITY INVOKER`.

The audit trigger uses a tightly scoped `SECURITY DEFINER` function solely so the admin role cannot forge audit rows directly. It is kept in the private `care_admin` schema and is not granted to PUBLIC, anon, authenticated, runtime service_role, or the admin role for direct invocation.

## Application model

The pure membership state machine mirrors the database contract.

`MembershipAdminService` depends on `MembershipAdminRepository`.

The reference Postgres repository uses an injected SQL executor so the Care Ops package does not take a runtime database-driver dependency.

## Consequences

- operational supervisors do not implicitly become identity administrators
- staff-access changes are replayable
- stale access-control writes fail closed
- revocation history is preserved
- runtime credentials cannot self-promote staff
- audit loss cannot silently accompany a successful snapshot update
