# Production Release Checklist

This checklist is intentionally stricter than the current prototype state.

Do not treat completion of the Core as production approval.

## Evidence discipline

Use [Staging Evidence Template](staging-evidence-template.md) for the first synthetic staging pass and [Production Evidence Index](production-evidence-index.md) to track environment/drill evidence.

Do not mark an environment/operations checkbox complete solely because repository code or a runbook exists.

Do not place secret values, resident/care payloads, access tokens, or raw sensitive evidence in GitHub.

## Architecture

- [ ] Case lifecycle invariants reviewed
- [ ] ADRs current
- [ ] Signal idempotency implemented
- [ ] SLA / escalation semantics defined
- [ ] production Postgres adapter implemented
- [ ] integration tests run against production-equivalent Postgres

## Identity and authorization

- [ ] production identity provider/environment intentionally provisioned
- [ ] verified-token-to-principal boundary configured
- [ ] membership provisioning/admin workflow implemented
- [ ] membership admin credential/runbook provisioned separately from runtime
- [ ] membership change audit replay verified
- [ ] deactivation/revocation drill completed
- [ ] tenant membership source defined
- [ ] role provisioning / revocation process documented
- [ ] inactive user access verified fail-closed
- [ ] service accounts separated from human principals
- [ ] authenticated HTTP boundary regression tests passing
- [ ] browser/client cannot submit trusted principalId or actorId
- [ ] browser client token-persistence review completed
- [ ] reference Auth/session bridge regression tests passing
- [ ] session shell refresh/sign-out behavior tested
- [ ] 401 -> reauthentication-required behavior tested
- [ ] failed mutation is not auto-replayed after reauthentication
- [ ] stale Console command refetch/no-replay behavior tested
- [ ] selection race / late-response protection tested
- [ ] least-privilege database/service credentials reviewed

## Data protection

- [ ] data classification completed
- [ ] personal / care / medical data scope approved
- [ ] encryption configuration reviewed
- [ ] secret manager configured
- [ ] key rotation process tested
- [ ] retention / deletion policy implemented
- [ ] backup provider / RPO / RTO assigned
- [ ] synthetic restore drill completed using backup/restore runbook
- [ ] synthetic/demo environments separated from production

## Application security

- [ ] RLS verified in deployed database
- [ ] PUBLIC / anon / authenticated grants reviewed
- [ ] service-role usage confined to trusted server environment
- [ ] runtime composition credential-routing test passing
- [ ] deployment adapter uses `createCareOpsDeployment` / operational server runtime instead of direct repository access
- [ ] deployment environment parser regression tests passing
- [ ] `npm run config:validate` passes in the target runtime environment
- [ ] config-doctor output reviewed to contain no credential values
- [ ] API runtime environment contains no membership-admin / provider-delivery / backup-operator secret class
- [ ] request-admission boundary regression tests passing
- [ ] production shared/edge rate limiter configured
- [ ] trusted admission key/source derivation reviewed
- [ ] rate-limit thresholds and abuse-response owner defined
- [ ] outbound dependency timeout configured and reviewed
- [ ] strict browser-origin boundary regression tests passing
- [ ] exact production Console origin(s) configured and reviewed
- [ ] command body/request-size limits reviewed
- [ ] audit actor spoofing regression tests passing
- [ ] cross-tenant access tests passing
- [ ] stale-write / concurrency tests passing
- [ ] dependency / supply-chain review completed
- [ ] package lockfile integrity / frozen install verified
- [ ] CI actions/images pinned to reviewed immutable revisions

## Operations

- [ ] structured logs
- [ ] default observability schema reviewed for PII leakage
- [ ] metrics / alerting
- [ ] payload-free outbox health monitor regression tests passing
- [ ] outbox worker identity / credentials separated in deployment
- [ ] dead-letter alert thresholds and response owner assigned
- [ ] delivery-key idempotency strategy validated per provider
- [ ] incident response runbook reviewed and incident owner assigned
- [ ] on-call / escalation ownership assigned
- [ ] health/readiness endpoints deployed and monitored
- [ ] recovery objectives approved
- [ ] rollback drill completed
- [ ] deployment environment inventory completed

## Product / human operations

- [ ] responder roles and responsibilities validated with target operators
- [ ] handoff semantics validated in field workflow
- [ ] completion evidence policy validated
- [ ] false alarm / decline / emergency handoff outcomes reviewed
- [ ] usability test for high-stress operation completed
- [ ] accessibility review completed

## Privacy / legal / governance

- [ ] privacy review
- [ ] contractual data-processing responsibilities defined
- [ ] consent / lawful basis confirmed where applicable
- [ ] audit / retention obligations reviewed
- [ ] production demo policy approved
- [ ] real-world PoC governance approved

Only after the applicable items are complete should production resident/care data be considered.
