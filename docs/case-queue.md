# Case Queue Projection

The Case Queue is the read model for the future Responder Console.

It does not change Case state. It explains which active Cases need attention and why.

## Input

```
tenant-scoped StoredCase[]
+ trusted tenant SLA policy
+ explicit now
+ authorized queue scope
```

## Output

Each queue item includes:

- Case identity
- priority
- status
- current assignee / handoff target
- current SLA stage
- stage age
- next deadline
- active breach state
- maximum active overdue duration
- breached stages
- an explicit attention reason

## Attention reasons

The projection does not expose an opaque AI score.

A Case is surfaced with one of:

- `sla_breach`
- `unacknowledged`
- `unassigned`
- `handoff_pending`
- `active`

This makes queue ordering explainable to operators and reviewers.

## Deterministic ordering

The current ordering is:

1. active SLA breach before non-breach
2. higher Case priority
3. larger active overdue duration for breached Cases
4. earlier next deadline
5. older Case creation time
6. Case ID tie-break

The comparator is implemented in `src/operations/queue.ts` and regression-tested.

## Visibility

### Dispatcher / supervisor / auditor

Tenant-wide active queue.

### Responder-only

Only Cases where the responder is:

- the current `assigneeId`, or
- the current `handoffTargetId`

Unassigned Cases are not shown in responder-only scope because the current authorization model assigns Cases through dispatcher/supervisor roles.

The same responder scope applies to direct Case detail, metrics, and capability reads. Knowing a Case ID does not widen responder visibility.

## Exclusions

`COMPLETED` and `CLOSED` Cases are excluded from the active worklist.

Historical Cases remain available through Case history/audit paths, not the operational queue.

## Trust boundary

The queue service does not accept an SLA policy from the client.

It resolves:

```
tenantId
  -> trusted TenantSlaPolicyDirectory
  -> validated CaseSlaPolicy
```

and authorizes membership before listing tenant Cases.

## UI rule

The future Responder Console should render this projection rather than reimplementing:

- SLA evaluation
- breach detection
- priority ordering
- responder visibility
- attention reasons

That keeps operational behavior consistent across web, mobile, exports, and future integrations.
