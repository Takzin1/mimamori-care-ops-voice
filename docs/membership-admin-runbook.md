# Membership Administration Runbook

This runbook covers the operational lifecycle of Care Ops staff membership.

It does not grant production approval by itself.

## Boundary

Runtime Care Ops traffic and membership administration use different trust paths.

Runtime:

```
service_role
  -> membership SELECT
  -> Case/Queue authorization
```

Membership control plane:

```
trusted membership administrator
  -> MembershipAdminService / care_admin functions
  -> versioned membership mutation
  + append-only audit event
```

Do not reuse the runtime service-role credential as a membership mutation credential.

## Supported lifecycle operations

- create membership
- replace roles
- deactivate
- reactivate
- change actor ID

Normal lifecycle removal is **deactivation**, not deletion.

## Required fields for every change

Every administrative change requires:

- tenant ID
- principal ID
- admin actor ID
- reason
- timestamp
- expected membership version for an existing membership

Do not use generic reasons such as `update` or `fix`.

Use a reason that another reviewer can understand later.

Examples:

```
initial responder provisioning
dispatcher duty added
staff transfer
leave of absence
employment ended
operator identifier migration
access restored after review
```

## Create membership

Before creating:

1. confirm the external Auth principal exists
2. confirm the intended tenant
3. confirm the actor ID is unique inside that tenant
4. choose the minimum required Care Ops roles
5. record the administrative reason

After creating:

1. reload the membership snapshot
2. verify version = 1
3. verify the first audit event is `membership_created`
4. verify actor/roles/active state
5. test one allowed and one denied Care Ops operation

## Replace roles

Role replacement is explicit.

Do not append hidden privileges through user metadata or Auth profile fields.

Procedure:

1. load current membership
2. review current version and roles
3. submit the complete new role set
4. verify version increments by one
5. verify `roles_replaced` audit event
6. verify removed privilege fails immediately on the next authenticated request

## Emergency revocation

For urgent staff-access removal:

1. identify tenant + principal
2. load current membership/version
3. submit `deactivate`
4. verify new snapshot has `active=false`
5. verify `membership_deactivated` audit event
6. attempt an authenticated Queue/Case request
7. confirm access fails closed
8. record the incident/change reference outside the application if required by organizational policy

Do not delete the membership or audit history.

If the administrator credential itself may be compromised, rotate/revoke that credential separately and treat the event as an incident.

## Reactivation

Reactivation is a new audited change.

Do not rewrite prior deactivation history.

Procedure:

1. confirm the principal is still the correct external identity
2. review prior audit history
3. confirm current roles are still appropriate
4. activate with a new reason
5. verify version increment
6. verify `membership_activated` audit event
7. test access again

## Actor ID migration

Actor IDs are operational machine identifiers and must match:

```
^[A-Za-z0-9._:-]{1,128}$
```

Do not use display names, spaces, emails with `@`, or free-form labels as actor IDs.

Changing actor ID is exceptional.

Use it only when the operational identifier itself must change.

Before changing:

- confirm the new actor ID is unique in the tenant
- confirm downstream references do not assume the old identifier is mutable history
- record the migration reason

The audit event preserves both previous and new actor IDs.

## Stale-version conflict

A stale administrative update must not be retried blindly.

On conflict:

1. reload current membership
2. read intervening audit events
3. reconsider the requested change
4. submit a new command against the current version only if still intended

Never force-update the snapshot around optimistic concurrency.

## Audit replay verification

For each principal, verify:

```
audit event count == membership version
```

The ordered audit stream must replay to the current membership snapshot.

Investigate immediately if:

- snapshot exists without version-matching events
- audit event exists without snapshot
- duplicate version appears
- actor/role/active state cannot be reproduced

## Rollback model

Membership administration is append-only from an audit perspective.

A logical rollback is another explicit change:

- role change -> replace roles again
- deactivate -> reactivate
- actor migration -> new actor migration if organizationally valid

Do not remove or edit prior audit events to simulate rollback.

## Credential handling

Membership-admin credentials:

- must not be committed to Git
- must not be exposed to browser code
- must not be reused as runtime service-role credentials
- should be stored in the deployment secret manager
- should have a documented owner and rotation path

## Revocation drill before production

Before production approval, execute a synthetic drill:

1. create synthetic staff membership
2. prove allowed operation works
3. deactivate membership
4. prove access fails immediately
5. verify audit event
6. reactivate only if required
7. archive drill evidence

Do not perform the first revocation drill with real resident/care data.
