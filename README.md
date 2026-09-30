# Mimamori Care Ops Voice

**Evidence-grounded voice incident operations for frontline care teams.**

Mimamori Care Ops Voice turns a frontline spoken report into a traceable Care Ops Case while keeping safety-critical decisions and external actions under deterministic rules and explicit human control.

```text
Voice
  → AssemblyAI final transcript
  → Situation Understanding
  → Critical Fact Guard
  → persisted Care Ops Case
  → deterministic SOP Next Action
  → Human Confirm
  → durable Outbox
```

## Why this exists

In care operations, the difficult part often starts **after** somebody notices that something may be wrong. A report still has to become an accountable case: someone must confirm what was heard, decide the next operational step, take ownership, hand off safely, and verify completion.

Mimamori Care Ops Voice focuses on that last mile.

## Demo scope

The current prototype supports synthetic near-miss / incident reports and extracts a bounded set of reported observations:

- fall
- collapse
- fever
- consciousness
- breathing
- injury
- uncertainty

The raw final transcript is retained as evidence. Structured facts are derived from that evidence and then passed through a local **Critical Fact Guard**. Unsupported model output cannot silently promote an unknown fact to confirmed.

Example:

```text
「高熱を出して倒れています。」
→ fall: unknown
→ collapse: confirmed
→ fever: confirmed
```

`倒れる` is not treated as proof of `転倒`.

## AI safety boundary

The LLM is a **Situation Understanding Layer**, not an autonomous clinical or operational decision maker.

It does **not**:

- diagnose a patient
- determine emergency severity
- choose the final SOP
- assign a responder
- accept a handoff
- complete or close a Case
- send an external communication without Human Confirm

Bedrock Converse is available as an opt-in server-side provider. If the provider times out, errors, or returns invalid output, the system falls back to the deterministic RuleBasedSituationUnderstandingProvider.

## Architecture

```text
Microphone
  ↓
AssemblyAI Realtime
  ↓ final Turn only
Raw Transcript Evidence
  ↓
Bedrock Situation Understanding (optional)
  ↓
Critical Fact Guard
  ↓
Care Ops Case + immutable source evidence
  ↓
Deterministic operational guidance
  ↓
Human Confirm
  ↓
Durable Outbox / delivery boundary
```

The browser never receives the long-lived AssemblyAI or Bedrock server credential.

## Evidence and accountability

The system preserves:

- exact raw transcript text
- transcript ID, language, and capture timestamp
- session-bound provenance
- Case ID / status / version
- explicit ownership and handoff state
- Human-confirmed communication drafts
- durable Outbox state
- evidence-backed completion semantics in the underlying Care Ops Engine

North-star metric: **Time to Completion (TTC)** — the time from an actionable signal to verifiable support completion.

## Failure behavior

The prototype is intentionally fail-closed around critical facts and side effects:

- ambiguous wording stays unknown
- contradictions produce uncertainty
- unsupported model facts are rejected by the guard
- malformed / oversized / timed-out AI responses fall back to rules
- stale Case versions are rejected
- duplicate communication approval is idempotent
- Human Confirm is required before outbound communication

## Run locally

Requirements:

- Node.js 24+

```bash
npm ci
npm run typecheck
npm test
npm run test:demo
```

A local deterministic benchmark is available:

```bash
node scripts/voice-situation-benchmark.mjs
```

## Optional Bedrock configuration

Server-side Preview variables:

```text
CARE_OPS_SITUATION_PROVIDER=bedrock
AWS_REGION=<authorized-region>
CARE_OPS_BEDROCK_MODEL_ID=<model-or-inference-profile-id>
AWS_BEARER_TOKEN_BEDROCK=<server-only-token>
CARE_OPS_SITUATION_TIMEOUT_MS=2500
```

If these variables are absent, the Situation Understanding layer defaults to the local rule-based provider.

## Key implementation files

- `src/voice/bedrock-situation.ts` — bounded Bedrock Converse adapter
- `src/voice/situation.ts` — provider-agnostic Situation Understanding + fallback
- `src/voice/critical-facts.ts` — Critical Fact Guard
- `src/http/voice-plan-http-api.ts` — authenticated final transcript → persisted Case path
- `src/voice/communication.ts` — signed Human Confirm drafts
- `src/voice/communication-worker.ts` — durable Outbox delivery boundary
- `demo/voice-ops/` — live voice demo UI
- `tests/bedrock-situation.test.ts` — AI boundary / timeout / guard regressions

## Verification snapshot

The submission snapshot is based on the last known green integration point before later experimental transport work:

- GitHub Actions CI #255: **success**
- 300 tests total / 298 pass / 0 fail / 2 environment-dependent skips
- PostgreSQL integration covered in CI
- Bedrock timeout/error/invalid-response fallback covered by regression tests
- Raw transcript evidence persistence covered by regression tests

The project remains a prototype and is **not production-ready or a medical device**. Use synthetic data only.

## License

MIT — see [LICENSE](LICENSE).
