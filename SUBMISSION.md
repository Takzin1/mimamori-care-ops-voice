# Hackathon Submission Copy

## Project Title
Mimamori Care Ops Voice

## Subtitle
Evidence-grounded voice incident operations for frontline care teams

## Short Description
Mimamori Care Ops Voice turns a frontline spoken incident report into a traceable Care Ops Case: raw transcript evidence is preserved, critical facts are structured through a guarded AI layer, deterministic SOP guidance is generated, and any external action still requires explicit Human Confirm.

## Long Description
Frontline care teams often face a dangerous operational gap between noticing something unusual and actually completing support. A resident may fall, collapse, develop a fever, or become unresponsive, but the spoken report still has to become a shared, accountable case: what exactly was observed, who owns the response, what should happen next, whether a handoff was accepted, and whether support was actually completed.

Mimamori Care Ops Voice is designed for that last mile.

A frontline worker speaks naturally. The system captures only the final speech transcript as evidence, preserves the raw text, and converts a bounded set of reported observations — fall, collapse, fever, consciousness, breathing, injury, and uncertainty — into structured facts. A Critical Fact Guard checks those facts against the original evidence so unsupported model output cannot silently become “confirmed.”

The AI layer is intentionally narrow. It does not diagnose, determine emergency severity, choose the final SOP, assign responders, accept handoffs, close Cases, or send external communications autonomously. Those responsibilities remain with deterministic workflow rules and accountable humans.

The operational flow is:

Voice → final transcript → Situation Understanding → Critical Fact Guard → persisted Care Ops Case → deterministic next action → Human Confirm → durable Outbox.

This architecture makes the raw evidence and the action workflow traceable together. The underlying Care Ops Engine records Case status, version, ownership, handoff, completion evidence, and operational timing. The north-star KPI is Time to Completion: how long it takes to move from an actionable signal to verifiable support completion.

AWS Bedrock Converse is implemented as a bounded server-side Situation Understanding provider. Model output is restricted to an allowlisted JSON contract, responses are size-bounded, tool execution is not enabled, and timeout / provider error / malformed output falls back to a deterministic RuleBasedSituationUnderstandingProvider. Long-lived provider credentials remain server-side.

The prototype is built for synthetic hackathon data and is not a medical device or production system. Its core design goal is not “AI decides what to do.” It is: AI helps structure what was reported, while evidence, deterministic workflow, and human accountability remain authoritative.

## Technology
- TypeScript / Node.js 24
- AWS Bedrock Converse integration
- AssemblyAI Realtime voice transcription
- Vercel Preview deployment
- Supabase / PostgreSQL persistence boundary
- Deterministic Critical Fact Guard
- Signed Human Confirm communication drafts
- Durable Outbox delivery boundary

## Tags
AI, AWS Bedrock, Voice AI, CareTech, HealthTech, Safety, Incident Response, Workflow Automation, Human-in-the-loop, TypeScript

## Application of Technology
Bedrock is used only for bounded Situation Understanding. The model receives untrusted transcript text as data, returns an allowlisted critical-fact JSON object, and cannot issue operational commands. A local Critical Fact Guard remains authoritative and deterministic fallback is automatic on timeout, provider error, or invalid output.

## Business Value
Care organizations lose time and context between a frontline report and coordinated action. Mimamori Care Ops Voice reduces that gap by turning voice into an accountable Case with preserved evidence, standardized next actions, explicit ownership, human-confirmed communication, and measurable Time to Completion.

## Originality
Most monitoring tools optimize detection or notification. Mimamori Care Ops begins after detection, at the point where accountable human action must start. The distinctive design is the combination of raw voice evidence, guarded fact extraction, deterministic operational workflow, Human Confirm, handoff accountability, and evidence-backed completion.

## Presentation Message
Do not pitch this as “AI that makes medical decisions.”

Pitch it as:
**“Voice becomes evidence. Evidence becomes a Case. AI structures the situation, but humans and deterministic workflow remain accountable until support is verifiably completed.”**

## Demo Walkthrough
1. Speak a synthetic incident report.
2. Show the final transcript.
3. Show structured facts and evidence-grounded uncertainty.
4. Show the persisted Case ID / status / version.
5. Show deterministic next action.
6. Show Human Confirm before outbound communication.
7. Show durable Outbox state.
8. Close on Time to Completion as the operational KPI.

## Safety Disclaimer
Prototype for synthetic demonstration data only. Not production-ready and not a medical device. No autonomous diagnosis, urgency decision, treatment recommendation, responder assignment, handoff acceptance, Case completion, or external communication without explicit human confirmation.
