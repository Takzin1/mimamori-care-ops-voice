# Application flow

The application layer is the operational coordinator between Signal adapters, trusted tenant membership, the pure Case Core, and persistence.

```
AttentionSignal
     |
     v
CaseService.openFromSignal()
     |
     v
case_created
     |
     v
CaseRepository
     |
     +--> current snapshot
     +--> append-only events
```

Every staff action goes through the same authorized path:

```
authenticated principal
  -> resolve tenant membership
  -> authorize command for role
  -> validate assignment / handoff target
  -> load tenantId + caseId
  -> bind trusted actorId
  -> execute pure Core command
  -> compare expectedVersion
  -> append event atomically
  -> return new aggregate
```

Read paths also require active tenant membership before the Case is loaded.

The application layer does not decide medical or welfare outcomes. It coordinates accountable human operations and makes the responsible actor traceable.

Signal adapters may differ by domain, but once a Signal becomes a Case, the lifecycle is identical.
