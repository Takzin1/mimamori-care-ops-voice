import {
  normalizeAssemblyAiTurn,
  type AssemblyAiRealtimeTurn,
} from "./assemblyai.ts";
import type {
  VoiceRealtimeSession,
  VoiceRealtimeSessionIssuer,
  VoiceRealtimeSessionRequest,
} from "./realtime-session.ts";
import type {
  VoiceTranscriptEvidence,
} from "./types.ts";

const DEFAULT_TOKEN_ENDPOINT =
  "https://streaming.assemblyai.com/v3/token";
const DEFAULT_WEBSOCKET_ENDPOINT =
  "wss://streaming.assemblyai.com/v3/ws";
const DEFAULT_TTL_SECONDS = 300;
const DEFAULT_SAMPLE_RATE_HZ = 16_000;

type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface AssemblyAiVoiceProviderOptions {
  apiKey: string;
  fetchImpl?: FetchLike;
  now?: () => string;
  tokenEndpoint?: string;
  websocketEndpoint?: string;
  sessionTtlSeconds?: number;
  sampleRateHz?: number;
}

function requiredSecret(
  value: string,
): string {
  const normalized = value.trim();

  if (
    normalized.length < 8 ||
    normalized.length > 16 * 1024 ||
    /\s/.test(normalized)
  ) {
    throw new Error(
      "AssemblyAI API key is unavailable or malformed",
    );
  }

  return normalized;
}

function positiveInteger(
  value: number,
  label: string,
  min: number,
  max: number,
): number {
  if (
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  ) {
    throw new Error(
      `${label} must be between ${min} and ${max}`,
    );
  }

  return value;
}

function httpsUrl(
  value: string,
  label: string,
): URL {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error(
      `${label} must be a valid URL`,
    );
  }

  if (url.protocol !== "https:") {
    throw new Error(
      `${label} must use https`,
    );
  }

  if (
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new Error(
      `${label} must not contain credentials or fragment`,
    );
  }

  return url;
}

function wssUrl(
  value: string,
): URL {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error(
      "AssemblyAI websocket endpoint must be a valid URL",
    );
  }

  if (url.protocol !== "wss:") {
    throw new Error(
      "AssemblyAI websocket endpoint must use wss",
    );
  }

  if (
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new Error(
      "AssemblyAI websocket endpoint must not contain credentials or fragment",
    );
  }

  return url;
}

function jsonRecord(
  value: unknown,
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error(
      "AssemblyAI response must be a JSON object",
    );
  }

  return value as Record<string, unknown>;
}

function tokenFromResponse(
  value: unknown,
): string {
  const record = jsonRecord(value);
  const token = record.token;

  if (
    typeof token !== "string" ||
    token.trim().length < 1
  ) {
    throw new Error(
      "AssemblyAI token response is missing token",
    );
  }

  return token.trim();
}

function isoAfter(
  now: string,
  seconds: number,
): string {
  const nowMs = Date.parse(now);

  if (!Number.isFinite(nowMs)) {
    throw new Error(
      "AssemblyAI provider clock must return ISO-compatible time",
    );
  }

  return new Date(
    nowMs + seconds * 1000,
  ).toISOString();
}

function sessionId(): string {
  return `aai-${crypto.randomUUID()}`;
}

export class AssemblyAiRealtimeSessionIssuer
implements VoiceRealtimeSessionIssuer {
  readonly #apiKey: string;
  readonly #fetchImpl: FetchLike;
  readonly #now: () => string;
  readonly #tokenEndpoint: URL;
  readonly #websocketEndpoint: URL;
  readonly #sessionTtlSeconds: number;
  readonly #sampleRateHz: number;

  constructor(
    options: AssemblyAiVoiceProviderOptions,
  ) {
    this.#apiKey =
      requiredSecret(
        options.apiKey,
      );
    this.#fetchImpl =
      options.fetchImpl ??
      fetch;
    this.#now =
      options.now ??
      (() =>
        new Date()
          .toISOString());
    this.#tokenEndpoint =
      httpsUrl(
        options.tokenEndpoint ??
          DEFAULT_TOKEN_ENDPOINT,
        "AssemblyAI token endpoint",
      );
    this.#websocketEndpoint =
      wssUrl(
        options.websocketEndpoint ??
          DEFAULT_WEBSOCKET_ENDPOINT,
      );
    this.#sessionTtlSeconds =
      positiveInteger(
        options.sessionTtlSeconds ??
          DEFAULT_TTL_SECONDS,
        "AssemblyAI session TTL",
        30,
        600,
      );
    this.#sampleRateHz =
      positiveInteger(
        options.sampleRateHz ??
          DEFAULT_SAMPLE_RATE_HZ,
        "AssemblyAI sample rate",
        8_000,
        96_000,
      );
  }

  async issue(
    request: VoiceRealtimeSessionRequest,
  ): Promise<VoiceRealtimeSession> {
    const issuedAt =
      this.#now();

    const tokenUrl =
      new URL(
        this.#tokenEndpoint,
      );

    tokenUrl.searchParams.set(
      "expires_in_seconds",
      String(
        this.#sessionTtlSeconds,
      ),
    );

    const response =
      await this.#fetchImpl(
        tokenUrl,
        {
          method: "GET",
          headers: {
            authorization:
              this.#apiKey,
            accept:
              "application/json",
          },
          cache: "no-store",
          credentials: "omit",
          redirect: "error",
          referrerPolicy:
            "no-referrer",
        },
      );

    const contentType =
      response.headers
        .get("content-type")
        ?.split(";", 1)[0]
        ?.trim()
        .toLowerCase();

    if (
      contentType !==
        "application/json"
    ) {
      throw new Error(
        "AssemblyAI token response is not JSON",
      );
    }

    const payload =
      await response.json();

    if (!response.ok) {
      const record =
        jsonRecord(payload);
      const providerMessage =
        typeof record.error === "string"
          ? record.error
          : typeof record.message === "string"
            ? record.message
            : "no provider message";

      console.error(
        JSON.stringify({
          event:
            "assemblyai_token_request_failed",
          status:
            response.status,
          providerMessage,
        }),
      );

      throw new Error(
        `AssemblyAI token request failed with HTTP ${response.status}`,
      );
    }

    const token =
      tokenFromResponse(
        payload,
      );

    const websocket =
      new URL(
        this.#websocketEndpoint,
      );

    websocket.searchParams.set(
      "sample_rate",
      String(
        this.#sampleRateHz,
      ),
    );
    websocket.searchParams.set(
      "token",
      token,
    );

    return {
      provider:
        "assemblyai",
      sessionId:
        sessionId(),
      websocketUrl:
        websocket.toString(),
      issuedAt,
      expiresAt:
        isoAfter(
          issuedAt,
          this.#sessionTtlSeconds,
        ),
      audio: {
        encoding:
          "pcm_s16le",
        sampleRateHz:
          this.#sampleRateHz,
      },
    };
  }
}

function asFiniteInteger(
  value: unknown,
): number | null {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value)
  )
    ? value
    : null;
}

function optionalString(
  value: unknown,
): string | undefined {
  return typeof value === "string" &&
    value.trim()
      ? value.trim()
      : undefined;
}

export function parseAssemblyAiRealtimeMessage(
  input: {
    sessionId: string;
    data: unknown;
    capturedAt: string;
  },
): VoiceTranscriptEvidence | null {
  let payload: unknown =
    input.data;

  if (
    typeof payload ===
      "string"
  ) {
    try {
      payload =
        JSON.parse(
          payload,
        );
    } catch {
      throw new Error(
        "AssemblyAI realtime message is not valid JSON",
      );
    }
  }

  const record =
    jsonRecord(
      payload,
    );

  if (
    record.type !== "Turn"
  ) {
    return null;
  }

  const transcript =
    optionalString(
      record.transcript,
    );

  if (!transcript) {
    return null;
  }

  const endOfTurn =
    record.end_of_turn ===
      true;

  if (!endOfTurn) {
    return null;
  }

  const turnOrder =
    asFiniteInteger(
      record.turn_order,
    );

  const turn:
    AssemblyAiRealtimeTurn = {
      transcriptId:
        turnOrder === null
          ? input.sessionId
          : `${input.sessionId}:${turnOrder}`,
      text:
        transcript,
      language:
        optionalString(
          record.language_code,
        ),
      capturedAt:
        input.capturedAt,
      isFinal: true,
    };

  return normalizeAssemblyAiTurn(
    turn,
  );
}
