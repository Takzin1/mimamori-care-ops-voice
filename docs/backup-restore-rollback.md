# Backup, Restore, and Rollback Runbook

## Production gate

Before production, the deployment owner must define and approve:

- backup provider
- backup frequency
- retention
- encryption/key ownership
- restore access
- RPO
- RTO
- restore-drill cadence

This repository does not invent RPO/RTO values.

## Restore drill order

Perform the first restore drill with synthetic/non-production data.

1. provision an isolated restore target
2. restore database backup
3. do not point production traffic at it yet
4. verify schema/migrations
5. verify Case snapshot/event replay
6. verify membership snapshot/audit replay
7. inspect payload-free outbox health
8. verify no stale worker leases are incorrectly resumed
9. run integration smoke tests
10. record duration and evidence

Only then may the organization decide whether the restore process satisfies its RPO/RTO.

## Post-restore integrity checks

### Case Store

For sampled/all affected Cases:

- event sequence starts at 1
- event sequence is contiguous
- replayed aggregate equals stored snapshot
- snapshot version equals last event sequence
- immutable Signal lineage matches

### Membership

For each affected principal:

- membership version matches audit sequence
- audit replay reconstructs active/roles/actor state
- deactivated principals remain deactivated

### Outbox

Check:

- pending/failed/dead-letter counts
- oldest actionable item
- max attempt count
- processing rows with expired leases
- provider-side idempotency before re-delivery

Do not assume restoring the database means external notifications/actions can be safely replayed.

## Application rollback

Preferred application rollback:

1. stop/pause promotion
2. return traffic to the last known-good immutable deployment
3. keep database state intact unless a schema/data migration requires separate recovery
4. verify health/readiness
5. run synthetic authorization/Case workflow smoke tests

Do not rewrite Case events or membership audit history to make the application appear rolled back.

## Database migration rollback

A migration rollback requires an explicit plan.

For additive migrations, prefer forward-fix where safer.

For destructive/schema-changing migrations:

- preserve a pre-migration backup
- document downgrade compatibility
- verify older application code can read the restored schema before traffic switch
- never remove audit evidence merely to satisfy an older schema

## Logical rollback

Operational mistakes are corrected through new auditable operations where possible.

Examples:

- role change -> explicit role replacement
- membership deactivate -> explicit reactivate after review
- Case reopen -> normal Case lifecycle event

Historical evidence remains immutable.

## Failed restore

If restore validation fails:

- do not promote the restore target
- preserve the failed target for diagnosis if safe
- identify whether failure is backup, migration, credential, or application compatibility
- update the runbook before the next drill

A successful backup job without a successful restore drill is not sufficient production evidence.
