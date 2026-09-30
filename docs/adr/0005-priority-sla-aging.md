# ADR 0005: Explicit Case priority and deterministic SLA aging

Status: Accepted

Date: 2026-09-25

## Context

A GK control room must surface Cases that are stalled, not merely store Cases correctly.

A single fixed deadline is insufficient because operational urgency differs across Cases. At the same time, hidden AI-derived priority would make deadlines difficult to audit.

## Decision

Each Case has an explicit priority:

- critical
- high
- normal
- low

Initial priority enters through the Signal/application boundary. Priority may later change only through an explicit `priority_changed` Case event.

Priority changes are authorized for dispatcher/supervisor roles and remain replayable.

## Clock semantics

Changing priority does **not** reset any operational clock.

The current priority selects the SLA duration, which is then applied to the original stage start time. Escalating a Case to a tighter priority may therefore create an immediate breach.

This prevents reclassification from erasing elapsed responsibility time.

## SLA policy

A tenant supplies a policy mapping each priority to deterministic durations for:

- acknowledgement
- assignment
- first action
- handoff acceptance
- completion

The evaluator receives:

```
aggregate + events + policy + explicit now
```

and returns:

- current stalled stage
- stage age
- checkpoint deadlines
- active breaches
- next deadline
- escalation recommendations

The evaluator has no hidden clock and performs no external side effects.

## Active vs historical breach

A checkpoint completed after its deadline remains historically `breached`.

However, it does not produce an active escalation recommendation after completion.

This preserves performance evidence without repeatedly escalating resolved work.

## AI boundary

AI does not silently set or change Case priority.

An upstream adapter may provide an explicit initial priority and authorized humans may reclassify it. Any future AI suggestion must remain advisory until a trusted actor accepts it.

## Consequences

- queue projections can deterministically rank operational urgency
- priority history is replayable
- SLA changes do not erase aging
- escalation delivery can be separated into a transactional outbox
- TTC remains measurable independently from SLA policy
