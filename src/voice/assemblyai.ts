import type {
  VoiceTranscriptEvidence,
} from "./types.ts";

export interface AssemblyAiRealtimeTurn {
  transcriptId: string;
  text: string;
  language?: string;
  capturedAt: string;
  isFinal: boolean;
}

function requireText(
  value: string,
  label: string,
): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} is required`);
  }
  return normalized;
}

export function normalizeAssemblyAiTurn(
  turn: AssemblyAiRealtimeTurn,
): VoiceTranscriptEvidence {
  if (!turn.isFinal) {
    throw new Error(
      "Only final AssemblyAI turns may enter Care Ops",
    );
  }

  const transcriptId = requireText(
    turn.transcriptId,
    "transcript id",
  );
  requireText(turn.text, "transcript text");
  const text = turn.text;
  const capturedAt = requireText(
    turn.capturedAt,
    "captured at",
  );

  if (!Number.isFinite(Date.parse(capturedAt))) {
    throw new Error("captured at must be ISO-compatible");
  }

  return {
    provider: "assemblyai",
    transcriptId,
    text,
    language: turn.language?.trim() || "und",
    capturedAt,
  };
}
