export type VoiceAudioEncoding =
  | "pcm_s16le"
  | "provider_native";

export interface VoiceRealtimeSession {
  provider: "assemblyai";
  sessionId: string;
  websocketUrl: string;
  issuedAt: string;
  expiresAt: string;
  audio: {
    encoding: VoiceAudioEncoding;
    sampleRateHz: number;
  };
}

export interface VoiceRealtimeSessionRequest {
  tenantId: string;
  actorId: string;
  caseId: string;
  subjectId: string;
  locale: string;
}

export interface VoiceRealtimeSessionIssuer {
  issue(
    request: VoiceRealtimeSessionRequest,
  ): Promise<VoiceRealtimeSession>;
}

const SAFE_IDENTIFIER =
  /^[A-Za-z0-9._:-]{1,128}$/;

function timestamp(
  value: string,
  label: string,
): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(
      `${label} must be ISO-compatible`,
    );
  }
  return parsed;
}

function identifier(
  value: string,
  label: string,
): string {
  const normalized = value.trim();
  if (!SAFE_IDENTIFIER.test(normalized)) {
    throw new Error(
      `${label} is invalid`,
    );
  }
  return normalized;
}

function validLocale(
  value: string,
): string {
  const normalized = value.trim();

  if (
    normalized.length < 2 ||
    normalized.length > 64 ||
    !/^[A-Za-z0-9-]+$/.test(normalized)
  ) {
    throw new Error("locale is invalid");
  }

  return normalized;
}

export function validateVoiceSessionRequest(
  request: VoiceRealtimeSessionRequest,
): VoiceRealtimeSessionRequest {
  return {
    tenantId: identifier(
      request.tenantId,
      "tenantId",
    ),
    actorId: identifier(
      request.actorId,
      "actorId",
    ),
    caseId: identifier(
      request.caseId,
      "caseId",
    ),
    subjectId: identifier(
      request.subjectId,
      "subjectId",
    ),
    locale: validLocale(
      request.locale,
    ),
  };
}

export function validateVoiceRealtimeSession(
  session: VoiceRealtimeSession,
  now: string,
): VoiceRealtimeSession {
  if (session.provider !== "assemblyai") {
    throw new Error(
      "unsupported voice realtime provider",
    );
  }

  const sessionId = identifier(
    session.sessionId,
    "sessionId",
  );

  let url: URL;
  try {
    url = new URL(session.websocketUrl);
  } catch {
    throw new Error(
      "voice realtime websocket URL is invalid",
    );
  }

  if (url.protocol !== "wss:") {
    throw new Error(
      "voice realtime websocket URL must use wss",
    );
  }

  const issuedAtMs = timestamp(
    session.issuedAt,
    "issuedAt",
  );
  const expiresAtMs = timestamp(
    session.expiresAt,
    "expiresAt",
  );
  const nowMs = timestamp(
    now,
    "now",
  );

  if (expiresAtMs <= issuedAtMs) {
    throw new Error(
      "voice realtime session expiry must follow issue time",
    );
  }

  if (nowMs >= expiresAtMs) {
    throw new Error(
      "voice realtime session is expired",
    );
  }

  if (
    !Number.isInteger(
      session.audio.sampleRateHz,
    ) ||
    session.audio.sampleRateHz < 8_000 ||
    session.audio.sampleRateHz > 96_000
  ) {
    throw new Error(
      "voice realtime sample rate is invalid",
    );
  }

  if (
    session.audio.encoding !==
      "pcm_s16le" &&
    session.audio.encoding !==
      "provider_native"
  ) {
    throw new Error(
      "voice realtime audio encoding is invalid",
    );
  }

  return {
    provider: "assemblyai",
    sessionId,
    websocketUrl: url.toString(),
    issuedAt: session.issuedAt,
    expiresAt: session.expiresAt,
    audio: {
      encoding: session.audio.encoding,
      sampleRateHz:
        session.audio.sampleRateHz,
    },
  };
}
