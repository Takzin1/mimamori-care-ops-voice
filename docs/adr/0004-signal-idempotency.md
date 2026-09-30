# ADR 0004: Signal idempotency and immutable lineage

Status: Accepted

Date: 2026-09-25

## Context

Signal adapters retry.

A network timeout, webhook retry, scheduled check, or upstream redelivery must not create multiple support Cases for the same real-world Signal.

A source-local signal ID is not globally unique because different adapters may issue the same value.

## Decision

The idempotency identity is:

```
tenantId
+ sourceAdapter
+ sourceSignalId
```

Case creation is retry-safe at both the repository contract and Postgres Case Store.

A compatible retry:

- returns the existing Case
- returns the original `case_created` event
- reports `created: false`
- does not append a second creation event

A retry with the same idempotency identity but changed `subjectId` or `sourceType` is rejected as `SIGNAL_REPLAY_MISMATCH`.

## Immutable lineage

Once a Case is created, these fields cannot change through normal Case transitions:

- tenantId
- caseId
- subjectId
- sourceType
- sourceAdapter
- sourceSignalId
- createdAt

Operational state may advance; origin lineage may not.

## Consequences

- upstream retries converge instead of duplicating work
- two adapters may safely reuse the same local signal ID
- lineage corruption is surfaced instead of silently accepted
- Postgres uniqueness provides the final concurrency boundary
- Case provenance remains stable for replay, audit, and research
