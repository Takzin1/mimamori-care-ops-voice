import type { CriticalFacts, CriticalFactEvidence } from "./critical-facts.ts";
import type {
  CasePriority,
} from "../core/types.ts";

export type VoiceIncidentKind =
  | "near_miss"
  | "incident";

export type VoiceIncidentUrgency =
  | "routine"
  | "attention"
  | "urgent";

export type ObservationState =
  | "confirmed"
  | "denied"
  | "unknown";

export interface VoiceTranscriptEvidence {
  provider: "assemblyai";
  transcriptId: string;
  text: string;
  language: string;
  capturedAt: string;
}

export interface SituationUnderstanding extends CriticalFacts {
  factEvidence: CriticalFactEvidence;
  processing?: { provider: "rule_based" | "bedrock" | "guarded_api"; durationMs: number; fallbackReason?: "timeout" | "provider_error" | "invalid_response"; guardedFacts?: number };
  summary: string;
  fall: ObservationState;
  collapse: ObservationState;
  fever: ObservationState;
  needsClarification: boolean;
  clarificationQuestions: string[];
}

export interface SituationUnderstandingProvider {
  understand(input: {
    subjectId: string;
    transcript: VoiceTranscriptEvidence;
  }): Promise<SituationUnderstanding>;
}

export interface IncidentObservation {
  key:
    | "breathing"
    | "uncertainty"
    | "consciousness"
    | "pain"
    | "injury"
    | "dizziness_continues"
    | "fall_occurred"
    | "collapse_occurred"
    | "fever"
    | "safe_position";
  label: string;
  state: ObservationState;
  value?: string;
}

export interface VoiceIncidentDraft {
  kind: VoiceIncidentKind;
  urgency: VoiceIncidentUrgency;
  recommendedPriority: CasePriority;
  subjectId: string;
  summary: string;
  currentState: string;
  needsGuidance: boolean;
  observations: IncidentObservation[];
  evidence: VoiceTranscriptEvidence;
  situation?: SituationUnderstanding;
}

export interface NextAction {
  id: string;
  label: string;
  instruction: string;
  source: "sop";
  required: boolean;
}

export interface GuidancePlan {
  policyId: string;
  policyVersion: string;
  actions: NextAction[];
  boundaryMessage: string;
}

export interface LocalizedGuidance {
  locale: string;
  heading: string;
  actions: NextAction[];
  boundaryMessage: string;
}

export type CommunicationAudience =
  | "supervisor"
  | "family";

export interface CommunicationDraft {
  id: string;
  caseId: string;
  audience: CommunicationAudience;
  channel: "message";
  body: string;
  requiresHumanApproval: true;
}

export interface ApprovedCommunication {
  draft: CommunicationDraft;
  approvedBy: string;
  approvedAt: string;
}

export interface IncidentExtractor {
  extract(input: {
    subjectId: string;
    transcript: VoiceTranscriptEvidence;
  }): Promise<VoiceIncidentDraft>;
}

export interface GuidanceTranslator {
  translate(input: {
    plan: GuidancePlan;
    locale: string;
  }): Promise<LocalizedGuidance>;
}
