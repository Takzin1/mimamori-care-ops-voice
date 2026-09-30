# Synthetic Demo Scenario

This scenario is safe for external demonstrations because every identity and record is synthetic.

## Situation

A synthetic resident, `subject-demo-001`, misses an expected check-in.

Signal:

```json
{
  "id": "signal-demo-001",
  "tenantId": "provider-demo",
  "sourceAdapter": "synthetic-checkin",
  "priority": "normal",
  "subjectId": "subject-demo-001",
  "type": "non_response"
}
```

## Operational timeline

| Time | Event | Accountable actor |
|---:|---|---|
| 00:00 | Case created | system |
| 00:02 | acknowledged | dispatcher-demo |
| 00:04 | assigned | responder-a |
| 00:05 | action started | responder-a |
| 00:08 | handoff requested | responder-a |
| 00:10 | handoff accepted | responder-b |
| 00:20 | support completed | responder-b |
| 00:22 | Case closed | supervisor-demo |

During 00:08–00:10, **responder-a remains the accountable assignee**. Responsibility moves only when responder-b accepts.

## Completion evidence

Synthetic completion:

```json
{
  "outcome": "confirmed_safe",
  "summary": "Synthetic phone confirmation completed",
  "evidence": [
    {
      "kind": "call",
      "ref": "synthetic-call-log:001"
    }
  ]
}
```

## Metrics

Expected values:

- Time to Acknowledge: 2 min
- Time to Assignment: 4 min
- Time to First Action: 5 min
- Time to Completion: 20 min
- Handoff Count: 1

This exact lifecycle is exercised in `tests/application-case-service.test.ts`.

## Demo rule

Never replace these synthetic identifiers with real names, phone numbers, LINE IDs, addresses, care records, or production evidence in a public or reviewer-facing demo.
