# Responder Console v0.1

Responder Console is the operator-facing surface for the GK / Last-mile model.

The v0.1 implementation is intentionally split into:

1. a tested presentation layer over real domain outputs
2. a browser-only synthetic reviewer demo

It is **not** yet a live production console.

## Product goal

The first screen should answer:

- which Case requires attention now?
- why is it surfaced?
- who currently owns it?
- is a handoff waiting?
- what SLA stage is stalled?
- what evidence exists?
- how long has support taken?

This is a control room for accountable support completion, not a generic monitoring dashboard.

## Read model

The active worklist comes from `CaseQueueProjection`.

The UI must not invent:

- SLA rules
- queue ranking
- tenant visibility
- responder visibility
- attention reasons

The presentation layer maps domain objects into browser-facing view models.

## Queue

Each card exposes:

- Case ID
- synthetic subject ID in reviewer mode
- priority
- status
- current owner
- handoff target
- stalled stage
- next deadline
- breach / overdue state
- explainable attention reason

Ordering remains the domain order from `projectCaseQueue()`.

## Case detail

The detail view exposes:

- immutable Case identity / lineage
- current priority and status
- current assignee
- handoff target
- version
- SLA evaluation
- TTC supporting metrics
- event timeline
- completion record and evidence

The timeline comes from the append-only event stream.

## Synthetic scenario

The reviewer demo walks through:

```
NEW
→ ACKNOWLEDGED
→ ASSIGNED
→ IN_PROGRESS
→ HANDOFF_PENDING
→ IN_PROGRESS
→ COMPLETED
→ CLOSED
```

The key visual moment is handoff:

```
request_handoff(A -> B)
owner remains A

accept_handoff(B)
owner becomes B
```

Completion then exposes evidence before the Case is closed.

## Security boundary

The synthetic demo:

- contains no real resident data
- contains no production endpoint
- contains no service-role key
- contains no browser `fetch()`
- does not persist browser state
- does not bypass tenant membership or command authorization

Live data wiring is deferred until production identity integration exists.

## Live Console sequence

A future authenticated Console should call a trusted server boundary:

```
browser
  -> authenticated server route / action
  -> principalId
  -> TenantMembershipDirectory
  -> CaseQueueService / CaseService
  -> PostgrestCaseRepository
```

The browser must never instantiate `PostgrestCaseRepository` directly.

## Reviewer demo

Open:

```
demo/responder-console/index.html
```

from a local static server.

The demo is designed for architecture review, pitch/reviewer walkthroughs, and UI boundary validation only.
