# Transactional Outbox

The outbox is the reliability boundary between committed Care Operations state and external delivery providers.

## Flow

```text
Case command
  -> database transaction
       -> Case snapshot
       -> Case event
       -> outbox message
  -> commit
  -> worker claim
  -> delivery adapter
       -> LINE / webhook / email / other provider
  -> delivered OR retry/dead-letter
```

No external HTTP request is made inside the Case transaction.

## Table

`care_outbox` tracks:

- tenant
- topic
- stable delivery key
- payload
- status
- attempt count / maximum attempts
- available time
- lease / worker
- delivered time
- last delivery error

Statuses:

```
pending
processing
failed
delivered
dead_letter
```

## Case event messages

`create_care_case()` and `append_care_case_event()` automatically insert:

```
topic: case.event.committed
deliveryKey: case-event:<caseId>:<sequence>
```

Because the insert is in the same transaction, a Case event cannot commit without its durable delivery intent.

Compatible Case retries do not produce duplicate outbox rows.

## Derived escalation messages

`enqueue_care_outbox()` supports durable messages that are not themselves Case events, including SLA escalation recommendations.

Callers must supply a deterministic delivery key.

The first logical payload for a key wins. Reusing the key for a different topic/payload is rejected.

## Claiming

`claim_care_outbox()`:

- scopes work to one tenant
- bounds the batch size
- uses `FOR UPDATE SKIP LOCKED`
- increments attempt count
- assigns a worker and lease
- reclaims expired leases when attempts remain
- dead-letters expired work once the attempt limit is exhausted

## Completion and failure

`complete_care_outbox()` only acknowledges a message held by the same worker.

`fail_care_outbox()` records a bounded error string and either:

- schedules retry, or
- moves the message to `dead_letter`

when the maximum attempts are exhausted.

## TypeScript worker

`OutboxWorker.runOnce()` is explicit. It does not create a hidden background process.

It:

1. claims work
2. dispatches by topic
3. calls the provider adapter
4. acknowledges success or records failure

If provider delivery succeeds but acknowledgement cannot be confirmed, the run result reports `unconfirmed` rather than pretending delivery is durably complete.

## Adapter requirement

Every provider adapter receives the stable `deliveryKey`.

Where the provider supports idempotency, use that key directly.

Where it does not, provider-specific deduplication strategy must be documented before production use.
