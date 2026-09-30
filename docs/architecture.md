# Architecture

## Product boundary

Mimamori Care Ops begins where passive monitoring stops.

```
Signal adapter
    |
    v
+---------+
|  CASE   |
+---------+
    |
    +--> ACKNOWLEDGED
    |
    +--> ASSIGNED
    |
    +--> IN_PROGRESS
            |
            +--> HANDOFF_PENDING
            |       |
            |       +--> IN_PROGRESS
            |
            +--> COMPLETED
                    |
                    +--> CLOSED
```

## Responsibility invariant

A handoff must never create an ownership gap.

While a handoff is pending:

- the outgoing responder remains `assigneeId`
- the requested responder is stored as `handoffTargetId`
- ownership changes only on `handoff_accepted`

This is a core safety invariant, not a UI convention.

## Completion invariant

A Case cannot be completed by status change alone.

Completion requires:

1. current responder ownership
2. an explicit outcome
3. a human-readable completion summary
4. at least one evidence item

Evidence may be a call record, visit record, message, note, or external reference.

## Concurrency invariant

Every Case aggregate has a monotonically increasing `version`.

Commands must include the expected version. A stale command is rejected before transition. Persistence adapters must preserve the same compare-and-set behavior transactionally.

## Event log

The operational record is append-only.

Current event vocabulary:

- `case_created`
- `acknowledged`
- `assigned`
- `action_started`
- `handoff_requested`
- `handoff_accepted`
- `completed`
- `closed`
- `reopened`

The current Case state must be reproducible from the event stream.

## Adapter boundary

Signal sources are adapters, not Case Core features.

Examples:

- non-response
- unwell report
- SOS
- snow report
- disaster non-response
- welfare escalation
- free text
- manual operator entry
- external API

Adding a signal source must not require changing the Case state machine.

## AI boundary

AI may assist:

- normalization
- summarization
- extraction
- triage suggestions

AI must not silently:

- complete a Case
- accept a handoff
- replace accountable human ownership
- erase or rewrite operational evidence


## Tenant invariant

A Case belongs to exactly one `tenantId` from the moment `case_created` is emitted.

Persistence keys are scoped by `tenantId + caseId`, never by `caseId` alone. This allows provider organizations to operate independently even when identifiers collide, and prevents cross-tenant reads or writes by construction.

Tenant scope is immutable for the lifetime of a Case. Moving a Case between providers is modeled as an explicit transfer workflow, not by rewriting `tenantId`.


## Authorization invariant

A caller never supplies the audit actor identity directly.

The application boundary resolves:

```
tenantId + authenticated principalId
  -> active TenantMembership
  -> actorId + roles
```

before loading or mutating a Case.

Command authorization is role-based, while ownership-sensitive transitions remain enforced by the pure Case Core. Assignment and handoff targets must resolve to active responder/supervisor memberships in the same tenant.

This creates two independent checks:

1. **Application authorization** — may this principal perform this class of operation?
2. **Core responsibility invariant** — is this actor the accountable assignee/target for this specific Case state?

Both must pass.


## Signal lineage invariant

Signal delivery is retryable, but Case creation is idempotent.

The stable source identity is:

```
tenantId + sourceAdapter + sourceSignalId
```

Compatible retries return the existing Case rather than creating another workload item. Replays that reuse the same identity with a different subject or source type are rejected.

After `case_created`, origin lineage is immutable:

- tenantId
- caseId
- subjectId
- sourceType
- sourceAdapter
- sourceSignalId
- createdAt

Operational state can change; provenance cannot.


## Priority and SLA invariant

Each Case carries an explicit `critical / high / normal / low` priority.

Priority changes are append-only `priority_changed` events. They do not reset acknowledgement, assignment, action, handoff, or completion clocks.

SLA evaluation is pure and deterministic:

```
Case snapshot + event stream + tenant SLA policy + explicit now
  -> current stalled stage
  -> stage age
  -> next deadline
  -> active breaches
  -> escalation recommendations
```

The evaluator does not send notifications. Durable external escalation delivery belongs to the outbox boundary.


## Queue projection boundary

The operational worklist is a derived read model, not another Case state machine.

`projectCaseQueue()` combines active tenant Cases with the trusted SLA policy and produces an explainable, deterministic order for the control room.

Responder-only scopes expose current ownership and incoming handoffs. Dispatcher, supervisor, and auditor read scopes may see the tenant-wide queue.

Case detail visibility follows the same responder ownership scope: responders may read only Cases where they are the current assignee or handoff target. Direct Case/metrics/capability routes must not widen visibility beyond the Queue model.

UI clients must not reproduce queue ranking or SLA logic independently.


## External side-effect invariant

Case transactions do not call external notification providers.

A committed Case event and its durable `case.event.committed` outbox message are written in the same database transaction.

Workers claim outbox work with bounded leases and `FOR UPDATE SKIP LOCKED`, then invoke provider-specific adapters after the transaction has committed.

Delivery is at-least-once. Stable `deliveryKey` values are the logical idempotency boundary for downstream providers.

SLA evaluation remains pure; derived escalation recommendations are enqueued separately through the same outbox infrastructure.


## Production identity invariant

Human-facing application requests do not accept a trusted `principalId` from the caller.

The server path is:

```
access token
  -> PrincipalAuthenticator
  -> verified principalId
  -> persistent tenant membership
  -> Care Ops authorization
```

Authentication proves identity; it does not grant tenant access.

Care Ops actor identity and roles are resolved from `care_tenant_memberships`, not user-editable profile metadata. Invalid authentication fails before Case/Queue access.
