# Bedrock Situation Understanding (PR #73, Draft)

The server invokes Bedrock Converse only to extract reported observations. LLMs
cannot diagnose, decide urgency, select an SOP, assign a person, accept a handoff,
or complete/close a Case. Existing deterministic workflow and Human Confirm apply.

## Contract and Critical Fact Guard

`plan.incident.situation` contains `fall`, `collapse`, `fever`, `consciousness`,
`breathing`, `injury`, `uncertainty`, each `confirmed | denied | unknown`, plus
`factEvidence` (exact raw-text quote with UTF-16 start/end offsets), deterministic
summary/questions, and payload-free `processing` metrics.

`confirmed` means an explicit **reported** observation, not medical verification.
For consciousness and breathing it means **present**; denied means explicitly
absent. Injury/fall/collapse/fever mean the named event/condition is reported.
Uncertainty is confirmed for ambiguous/conflicting reports; no mention remains
unknown. Do not interpret unknown as normal/safe or confirmed as a diagnosis.

The local Critical Fact Guard remains authoritative: a model cannot promote an
unknown fact or override an explicit negation. V1 deliberately does not extend
critical-fact language coverage beyond the conservative local parser. All model
free prose, extra fields and command-like outputs are rejected; summaries and
clarification prompts are generated locally. Bedrock success means a valid model
response was checked, not that unchecked model facts were accepted. `guardedFacts`
counts disagreements overridden by the guard. Unrecognized wording stays unknown;
this is a limited demo parser, not a general clinical language recognizer.

Example: `高熱を出して倒れています。` gives fall unknown, collapse confirmed,
fever confirmed, consciousness/breathing/injury/uncertainty unknown. 倒れる does not
imply 転倒. Negative, uncertain, conflicting and historical reports are covered by
regressions; field evidence never comes from model prose.

## Evidence persistence

The final AssemblyAI transcript text is retained exactly, including whitespace,
through browser capture, HTTP parsing, plan and `case_created.data.sourceEvidence`.
The existing transactional Case Store persists the event JSON with the Case and
internal event Outbox. No schema migration is required. Tenant authorization and
server-signed session receipt still precede ingestion. Provenance is
`client_relayed_session_bound`, not provider-signed transcript authenticity.
Raw evidence is not included in operational metrics or logs. Existing authenticated
Case event readers can read it; apply the same sensitive-record retention/access
policy as Case events and the internal committed-event Outbox. Reusing a transcript
identity with altered evidence is rejected before issuing communication Drafts.

## Preview configuration

Set only Preview server environment variables:

- `CARE_OPS_SITUATION_PROVIDER=bedrock` (default `rule_based`)
- `AWS_REGION`: region authorized for the model
- `CARE_OPS_BEDROCK_MODEL_ID`: authorized Converse model or inference-profile ID
- `AWS_BEARER_TOKEN_BEDROCK`: Bedrock bearer API key, never a browser variable
- `CARE_OPS_SITUATION_TIMEOUT_MS=2500` (integer 1–10000)

This adapter supports Bedrock API-key authentication. It does not implement AWS
access-key/SigV4 or role credential discovery. Restrict the key to intended models
and manage its expiry server-side. No arbitrary endpoint, redirects, client key,
additional dependency, or model tool execution is used. The response is bounded
at 16 KiB and 320 generated tokens; malformed/truncated/error output falls back.
A full-call deadline covers headers and response-body reading, races hung transports,
and aborts in-flight fetch. Timeout returns RuleBasedSituationUnderstandingProvider.
No retry is made in the latency-sensitive request.

Official contracts:
- https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html
- https://docs.aws.amazon.com/bedrock/latest/userguide/api-keys-use.html

## Verification and latency

- `npm test`, `npm run typecheck`, `npm run test:demo`
- `node scripts/voice-situation-benchmark.mjs`: local rules, 100 synthetic inputs
- `node scripts/voice-situation-benchmark.mjs --bedrock`: 5 live Bedrock calls with
  synthetic text; requires the server environment above, fails on any fallback
- `CARE_OPS_REQUIRE_BEDROCK=1 npm run voice:e2e`: authenticated Preview backend
  gate; checks Bedrock success before Human Confirm/Outbox, reports timings

`processing.durationMs` measures situation extraction/guard/fallback.
`timings.planTotalMs` measures server plan-route handling including authorization,
Case persistence and signed Drafts. The UI adds `finalToPlanMs` for the browser
final-Turn request through parsed response. These exclude speech duration and
AssemblyAI endpointing and are not full mouth-to-screen latency.

Real microphone gate (synthetic persona only): open the commit-specific protected
Preview, click Live mic, speak the fever/collapse sample, check final transcript,
provider `bedrock` with no fallback, facts, persisted Case, deterministic SOP and
explicit Human Confirm → Outbox. Repeat negative and uncertain samples. Keep PR
#73 Draft regardless; do not promote production. A synthetic backend gate, mocked
Bedrock benchmark, or cloud-browser virtual microphone is not a real-mic pass.
