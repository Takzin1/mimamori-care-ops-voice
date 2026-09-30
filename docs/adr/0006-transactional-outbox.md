# ADR 0006: Transactional outbox for external side effects

Status: Accepted

Date: 2026-09-26

## Context

A Case transition can commit successfully while an external notification fails, or an external notification can succeed while the process crashes before recording success.

Calling LINE, email, webhook, or another network service inside the Case database transaction would couple operational integrity to an unreliable external dependency.

## Decision

External side effects are separated by a transactional outbox.

For every committed Case event, the same database transaction inserts a durable outbox message:

```
topic = case.event.committed
deliveryKey = case-event:<caseId>:<sequence>
```

The transaction therefore commits:

```
Case snapshot
+ append-only Case event
+ durable outbox message
```

or rolls back all three.

## Delivery semantics

The outbox provides:

- durable storage
- tenant-scoped delivery
- stable logical delivery keys
- worker leasing
- `FOR UPDATE SKIP LOCKED` concurrency
- retry metadata
- delivery acknowledgement
- dead-letter state after the configured attempt limit

The external delivery model is **at-least-once**, not exactly-once.

A provider may receive the same logical message again if external delivery succeeds but the database acknowledgement fails. Delivery adapters must therefore preserve and use `deliveryKey` as an idempotency key whenever the provider supports one.

## Logical key integrity

Re-enqueueing the same `tenantId + deliveryKey` with the same topic/payload is idempotent.

Reusing the same key with a different topic or payload is rejected as `OUTBOX_DELIVERY_KEY_CONFLICT`.

## SLA escalation

SLA evaluation remains pure.

A scheduler or escalation coordinator may enqueue a deterministic SLA message, for example:

```
sla:<caseId>:<stage>:<dueAt>
```

through `enqueue_care_outbox()`.

The SLA engine itself does not perform network I/O.

## Worker lease

A worker:

1. claims ready messages for one tenant
2. receives a bounded lease
3. attempts external delivery
4. records `delivered`, or
5. records `failed` with a retry time
6. reaches `dead_letter` when attempts are exhausted

Expired leases are reclaimable until the maximum attempt count is reached.

## Security boundary

Outbox table access and RPC execution are server-side service-role operations.

Browser, LIFF, and mobile clients never receive the service-role key and do not claim delivery work directly.

## Consequences

- Case correctness no longer depends on a live notification provider
- committed events cannot silently lose their delivery intent
- retries do not create a second logical message
- provider-specific adapters remain outside the Case Core
- delivery failures become observable operational state
