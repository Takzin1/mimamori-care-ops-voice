# Staging Evidence Template

Use this template for synthetic-data staging before any production resident/care data is considered.

Do **not** paste secrets, access tokens, resident identifiers, medical/care payloads, or raw completion evidence into GitHub.

Evidence may live in a restricted system. This document records only safe references and review outcomes.

## Record metadata

- Environment: `staging`
- Git commit / release:
- API deployment ID:
- Console deployment ID:
- Database/Auth project ID:
- Data region:
- Exact Console origin:
- Test date:
- Test owner:
- Reviewer:
- Data class: **synthetic only**
- Restricted evidence location/reference:
- Overall result: `PASS / FAIL / BLOCKED`

## Safe automated boundary preflight

After the staging API and exact Console origin are provisioned, run:

```bash
npm run preflight:staging -- \
  --base-url https://api.example.test \
  --console-origin https://console.example.test
```

This credential-free check sends no access token, resident data, Case payload, or completion evidence. It verifies:

- `GET /healthz`
- `GET /readyz`
- unexpected browser Origin -> 403 `ORIGIN_NOT_ALLOWED`
- allowed exact-origin CORS preflight -> narrow 204 response
- allowed browser Origin without a token -> 401 `AUTHENTICATION_REQUIRED`

Record only the command result and a safe execution reference. Do not paste secrets or sensitive runtime logs into GitHub.

For repeatable GitHub-hosted evidence, use **Actions -> Staging Preflight -> Run workflow** and provide only the synthetic staging API base URL and exact Console origin. The workflow is manual, read-only, uses no repository secrets, and runs the same credential-free preflight command. The workflow run URL can be recorded as the safe evidence reference.

The preflight does **not** prove rate-limit thresholds, authenticated RBAC, database grants/RLS, provider delivery, backup/restore, incident handling, or human workflow validation. Those still require the checks below.

## 1. Environment separation

| Check | Result | Safe evidence reference | Notes |
|---|---|---|---|
| Staging project is separate from production |  |  |  |
| Reviewer demo is separate from staging |  |  |  |
| Production secrets are not present in CI/reviewer demo |  |  |  |
| Browser receives only public/publishable configuration |  |  |  |
| Runtime/admin/worker credentials are distinct |  |  |  |
| API runtime environment passes deployment parser |  |  | `npm run config:validate` |
| Membership-admin/provider-delivery/backup-operator secrets are absent from API runtime |  |  |  |

## 2. Identity and membership

| Check | Result | Safe evidence reference | Notes |
|---|---|---|---|
| Synthetic staff principal can authenticate |  |  |  |
| Membership created through audited control plane |  |  |  |
| Membership audit version increments correctly |  |  |  |
| Allowed role can access expected Queue/Case |  |  |  |
| Denied role receives expected authorization failure |  |  |  |
| Responder cannot read unrelated same-tenant Case |  |  |  |
| Deactivate immediately removes Care Ops access |  |  |  |
| Reactivate restores only intended access |  |  |  |
| Service account and human principal are separate |  |  |  |

## 3. Browser / edge boundary

| Check | Result | Safe evidence reference | Notes |
|---|---|---|---|
| Exact Console origin is configured |  |  |  |
| Staging boundary preflight passes |  |  | `npm run preflight:staging` |
| Unexpected Origin fails closed |  |  |  |
| CORS preflight allows only intended method/header set |  |  |  |
| Browser contains no service-role/admin secret |  |  |  |
| Session state contains no persisted Care Ops token |  |  |  |
| 401 produces reauthentication-required flow |  |  |  |
| Failed mutation is not auto-replayed after reauth |  |  |  |

## 4. Request admission / abuse controls

| Check | Result | Safe evidence reference | Notes |
|---|---|---|---|
| Shared/edge admission provider is configured |  |  |  |
| Trusted rate-limit key/source derivation reviewed |  |  |  |
| Normal request is allowed |  |  |  |
| Limit breach returns 429 |  |  |  |
| Retry-After behavior is as designed |  |  |  |
| Admission backend failure returns safe 503 |  |  |  |
| Health/readiness probes still operate |  |  |  |
| Abuse alerts/owner are configured |  |  |  |

## 5. Database / authorization boundary

| Check | Result | Safe evidence reference | Notes |
|---|---|---|---|
| RLS enabled in deployed database |  |  |  |
| anon/authenticated direct table access is denied |  |  |  |
| runtime service-role direct Case/event/outbox DML is denied |  |  |  |
| approved RPC lifecycle succeeds |  |  |  |
| stale version update fails |  |  |  |
| cross-tenant Case read fails |  |  |  |
| cross-tenant Case write fails |  |  |  |
| membership admin remains separate from runtime role |  |  |  |

## 6. Live Console workflow

Execute with synthetic scenario data.

```
NEW
-> ACKNOWLEDGED
-> ASSIGNED
-> IN_PROGRESS
-> HANDOFF_PENDING
-> IN_PROGRESS
-> COMPLETED + evidence
-> CLOSED
```

| Check | Result | Safe evidence reference | Notes |
|---|---|---|---|
| Queue loads and preserves server ordering |  |  |  |
| Case selection loads detail/metrics |  |  |  |
| Acknowledge |  |  |  |
| Assign |  |  |  |
| Start action |  |  |  |
| Request handoff |  |  |  |
| Accept handoff |  |  |  |
| Complete with synthetic evidence |  |  |  |
| Close |  |  |  |
| 409 stale conflict refreshes without replay |  |  |  |
| Historical Case remains reviewable after leaving active Queue |  |  |  |

## 7. Observability

| Check | Result | Safe evidence reference | Notes |
|---|---|---|---|
| Structured request logs arrive |  |  |  |
| Metrics backend receives request counters/latency |  |  |  |
| health/readiness monitoring configured |  |  |  |
| 4xx/5xx alerts configured |  |  |  |
| admission denial/error alerts configured |  |  |  |
| logs contain no Authorization token |  |  |  |
| logs contain no request body |  |  |  |
| logs contain no resident/Case payload fields by default |  |  |  |

## 8. Outbox / delivery

| Check | Result | Safe evidence reference | Notes |
|---|---|---|---|
| Worker identity/credential is separate |  |  |  |
| Delivery key idempotency validated |  |  |  |
| Normal delivery succeeds |  |  |  |
| Retry path succeeds |  |  |  |
| Delivered-but-unconfirmed path is observable |  |  |  |
| Synthetic dead letter can be created safely |  |  |  |
| Dead-letter alert fires |  |  |  |
| Replay requires explicit operator approval |  |  |  |

## 9. Backup / restore / rollback

| Check | Result | Safe evidence reference | Notes |
|---|---|---|---|
| Backup provider assigned |  |  |  |
| RPO/RTO approved |  |  |  |
| Isolated synthetic restore completed |  |  |  |
| Case event replay matches restored snapshot |  |  |  |
| Membership audit replay matches restored state |  |  |  |
| Outbox state reviewed after restore |  |  |  |
| Application rollback drill completed |  |  |  |
| Drill duration recorded |  |  |  |

## 10. Secret rotation / incident drill

| Check | Result | Safe evidence reference | Notes |
|---|---|---|---|
| Runtime credential rotated |  |  |  |
| Old runtime credential fails |  |  |  |
| Worker/provider credential rotated |  |  |  |
| Old worker/provider credential fails |  |  |  |
| Synthetic incident drill/tabletop completed |  |  |  |
| Incident owner/escalation path confirmed |  |  |  |
| Runbook gaps captured |  |  |  |

## 11. Human workflow validation

| Check | Result | Safe evidence reference | Notes |
|---|---|---|---|
| Queue readability reviewed by target operator |  |  |  |
| High-stress Case selection tested |  |  |  |
| Assignment/handoff semantics understood |  |  |  |
| Completion evidence workflow understood |  |  |  |
| False alarm/declined/emergency outcomes reviewed |  |  |  |
| Accessibility review completed |  |  |  |

## 12. Privacy / governance gate

These may remain BLOCKED during early synthetic staging.

| Check | Result | Safe evidence reference | Notes |
|---|---|---|---|
| Data classification completed |  |  |  |
| Retention/deletion policy approved |  |  |  |
| Lawful basis/consent reviewed where applicable |  |  |  |
| Contractual processing responsibilities defined |  |  |  |
| Audit/retention obligations reviewed |  |  |  |
| Real-world PoC owner assigned |  |  |  |
| Incident/contact path approved |  |  |  |

## Exit decision

- [ ] All applicable staging technical controls passed
- [ ] Remaining blockers are explicitly listed
- [ ] No real resident/care data used
- [ ] Security findings requiring code changes are tracked separately
- [ ] Production promotion is **not** implied by staging PASS

### Blockers

-
-
-

### Reviewer conclusion

- Decision: `PASS / FAIL / CONDITIONAL`
- Reviewer:
- Date:
- Follow-up issue(s):
