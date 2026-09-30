# Outbox and Dead-Letter Operations

## Purpose

The transactional outbox decouples committed Care Ops state from external delivery while preserving a stable delivery key.

External delivery is at-least-once in failure scenarios unless the provider supports stronger semantics.

## Worker identity

Each worker process/execution must use a stable, operationally attributable `workerId`.

Do not use:

- resident identifiers
- access tokens
- service-role keys
- random payload content

Worker credentials must be server-side and separated from browser credentials.

Where deployment infrastructure allows, use a worker-specific credential/identity rather than reusing unrelated administrative credentials.

## Lease semantics

A worker claims messages for a bounded lease.

Another worker must not complete/fail a message claimed by a different `workerId`.

Expired leases may be reclaimed according to the SQL contract.

Do not manually edit lease columns.

## Delivery idempotency

Every provider handler must define what the outbox `deliveryKey` means downstream.

Before production:

- verify repeated delivery with the same key is safe
- document provider idempotency behavior
- determine the duplicate-effect response procedure

Care Ops delivery keys are operational identifiers, not authorization credentials.

## Monitoring

Use the payload-free outbox health projection for normal monitoring.

Track at minimum:

- pending
- processing
- failed
- dead-letter
- oldest actionable timestamp
- oldest dead-letter timestamp
- maximum attempt count

Delivered count is optional and can be excluded from routine queries.

Do not export payload/last_error into high-cardinality dashboards.

## Suggested alert conditions

The production owner must choose thresholds appropriate to the service.

Alert concepts:

- dead-letter count > 0
- failed count sustained above threshold
- oldest actionable age above delivery objective
- processing item older than expected lease/recovery window
- rapid attempt-count growth
- delivery provider error-rate increase

The repository intentionally does not invent operational thresholds.

## Dead-letter response

When dead letters appear:

1. acknowledge the alert
2. identify affected topic/provider
3. inspect payload-free health first
4. use restricted operational access for specific message investigation
5. determine whether retry can cause duplicate external effects
6. fix provider/configuration/root cause
7. obtain an explicit operator decision before replay/requeue
8. document delivery keys replayed

Do not reset attempt counts or statuses by direct table UPDATE.

## Delivered-but-unconfirmed

If provider delivery succeeded but the worker could not confirm completion, treat it as duplicate-risk.

Before retry:

- query provider outcome when possible
- use provider idempotency key
- avoid blind replay

The worker's `unconfirmed` result exists specifically to make this state visible.

## Payload handling

Outbox payloads inherit the sensitivity of the originating Case event.

Never dump full payloads into:

- public logs
- CI
- generic analytics
- screenshots
- issue trackers

## Recovery

After an outage:

1. verify provider availability
2. verify worker credential
3. inspect outbox health
4. resume workers gradually if needed
5. watch failed/dead-letter growth
6. verify provider idempotency under retry
