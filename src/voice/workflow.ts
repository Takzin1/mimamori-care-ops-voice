import type {
  AttentionSignal,
} from "../application/types.ts";
import type {
  CommunicationDraft,
  GuidanceTranslator,
  IncidentExtractor,
  LocalizedGuidance,
  VoiceIncidentDraft,
  VoiceTranscriptEvidence,
} from "./types.ts";
import {
  recommendNextActions,
} from "./guidance.ts";
import {
  createCommunicationDrafts,
} from "./communication.ts";

export interface VoiceOpsPlan {
  signal: AttentionSignal;
  incident: VoiceIncidentDraft;
  guidance: LocalizedGuidance;
  communicationDrafts: CommunicationDraft[];
}

export async function buildVoiceOpsPlan(input: {
  tenantId: string;
  caseId: string;
  subjectId: string;
  locale: string;
  transcript: VoiceTranscriptEvidence;
  extractor: IncidentExtractor;
  translator: GuidanceTranslator;
}): Promise<VoiceOpsPlan> {
  const incident = await input.extractor.extract({
    subjectId: input.subjectId,
    transcript: input.transcript,
  });
  const plan = recommendNextActions(incident);
  const guidance = await input.translator.translate({
    plan,
    locale: input.locale,
  });

  return {
    signal: {
      id: input.transcript.transcriptId,
      tenantId: input.tenantId,
      sourceAdapter: "assemblyai-realtime",
      subjectId: input.subjectId,
      type: "manual",
      priority: incident.recommendedPriority,
      sourceEvidence: { ...input.transcript, provenance: "client_relayed_session_bound" },
    },
    incident,
    guidance,
    communicationDrafts: createCommunicationDrafts({
      caseId: input.caseId,
      incident,
    }),
  };
}
