# Mimamori Ops Voice

Mimamori Ops Voice is a provider-bounded Voice Operations layer for frontline care workflows.

## Implemented live path

Authenticated operator
→ short-lived AssemblyAI session
→ browser microphone
→ mono PCM16 realtime stream
→ AssemblyAI final Turn
→ Voice Evidence
→ incident extraction
→ persisted Care Ops Case
→ deterministic SOP Next Action
→ localized guidance
→ supervisor/family communication drafts
→ human approval
→ durable Outbox
→ approved communication delivery worker
→ server-side HTTPS provider gateway

The browser never receives the long-lived AssemblyAI provider credential.

## Safety boundary

The Voice layer does not diagnose, decide final emergency severity, assign accountable ownership, accept a handoff, complete a Case, or close a Case.

Near-miss / incident classification belongs to the Voice layer. The existing Case lifecycle remains authoritative.

Only final AssemblyAI turns enter the operational plan. Partial turns may be rendered in the UI but are not persisted as operational evidence.

A Voice incident may create a Case, but assignment, handoff, completion, and close continue to use the existing Care Ops state machine.

## Multilingual boundary

Deterministic SOP guidance is generated before language localization.

`ClaudeGuidanceTranslator` is implemented as a guarded provider boundary:

- action IDs must be preserved;
- action count and order must be preserved;
- `required` and `source: sop` semantics are reconstructed from the original plan, not trusted from the LLM;
- unexpected or missing fields fail closed.

The transport that calls a current Claude/Anthropic API is intentionally injected rather than hard-coded into the domain layer.

## Communication boundary

Communication drafts are not delivered directly from the browser.

The authenticated approval route:

`POST /api/care-ops/tenants/:tenantId/voice/communications/approve`

binds `approvedBy` to the authenticated Care Ops actor and stamps `approvedAt` on the server. Auditors cannot approve.

The signed Draft also carries the canonical Case version and a short validity window. Approval re-reads the Case and rejects stale-version, completed, closed, expired, or tampered Drafts before Outbox enqueue.

Approved messages are enqueued to the existing transactional Outbox under:

`care_ops.communication`

The Outbox payload does not contain destination phone numbers or email addresses.

`ApprovedCommunicationOutboxHandler`, `WebhookCommunicationSender`, and `createVoiceCommunicationWorker` provide the delivery boundary. The server-side resolver selects the provider gateway and destination policy.

## Browser demo

`demo/voice-ops` supports both deterministic Synthetic mode and Live mode.

Live mode:

1. requests a short-lived Voice session bound to the tenant, actor, proposed Case ID, and subject ID;
2. streams microphone audio to AssemblyAI;
3. renders partial turns;
4. sends only the final Turn to `/voice/plan`;
5. persists the resulting Case;
6. renders incident/SOP/multilingual guidance;
7. renders supervisor/family drafts;
8. sends explicit human approval to the communication approval route;
9. receives durable Outbox queue confirmation.

## Current implementation boundary

Implemented:
- AssemblyAI short-lived token/session issuer;
- AssemblyAI realtime Turn parser;
- authenticated Voice Session API;
- browser microphone capture, resampling, PCM16, WSS transport;
- final-turn evidence normalization;
- persisted Case creation from Voice signal;
- deterministic near-miss / incident extraction for the current demo scope;
- deterministic SOP guidance;
- Japanese passthrough + synthetic Indonesian demo translator;
- guarded Claude guidance translator interface;
- supervisor/family drafts;
- authenticated human approval route;
- durable communication Outbox enqueue;
- approved communication Outbox handler;
- HTTPS webhook sender with server-side destination resolution;
- delivery worker factory;
- Live/Synthetic browser demo;
- unit/integration regressions around these boundaries.

Still required for an actual live smoke test:
- inject a real AssemblyAI credential into the server-only deployment composition;
- run microphone → AssemblyAI → final Turn against the real service;
- configure a current Claude transport if real model translation is desired;
- configure a real provider gateway/webhook if actual external delivery is desired.

The hackathon demo and tests must use synthetic subjects and synthetic incident data only.
