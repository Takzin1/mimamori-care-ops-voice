import type {
  CommunicationDraft,
} from "./types.ts";
import type {
  VoiceRealtimeSession,
} from "./realtime-session.ts";
import type {
  VoiceTranscriptEvidence,
} from "./types.ts";

const VERSION =
  "hmac-sha256-v1";
const MAX_SECRET =
  16 * 1024;
const MAX_RECEIPT =
  16 * 1024;
const CLOCK_SKEW_MS =
  30_000;
const RECEIPT_GRACE_MS =
  60_000;
const DRAFT_TTL_MS =
  15 * 60_000;

export interface SignedCommunicationDraft
extends CommunicationDraft {
  integrity: {
    version:
      typeof VERSION;
    signature: string;
    caseVersion: number;
    issuedAt: string;
    expiresAt: string;
  };
}

export interface VerifiedCommunicationDraft {
  draft: CommunicationDraft;
  caseVersion: number;
  issuedAt: string;
  expiresAt: string;
}

export interface VoiceSessionReceiptClaims {
  tenantId: string;
  actorId: string;
  caseId: string;
  subjectId: string;
  sessionId: string;
  issuedAt: string;
  expiresAt: string;
}

export interface VoiceIntegrity {
  issueSessionReceipt(input: {
    tenantId: string;
    actorId: string;
    caseId: string;
    subjectId: string;
    session:
      VoiceRealtimeSession;
  }): Promise<string>;

  verifySessionReceipt(input: {
    receipt: string;
    tenantId: string;
    actorId: string;
    caseId: string;
    subjectId: string;
    transcript:
      VoiceTranscriptEvidence;
    now: string;
  }): Promise<void>;

  signCommunicationDraft(
    tenantId: string,
    draft:
      CommunicationDraft,
    context: {
      caseVersion: number;
      now: string;
    },
  ): Promise<
    SignedCommunicationDraft
  >;

  verifyCommunicationDraft(
    tenantId: string,
    draft:
      SignedCommunicationDraft,
    now: string,
  ): Promise<
    VerifiedCommunicationDraft
  >;
}

function requiredSecret(
  value: string,
): string {
  const normalized =
    value.trim();

  if (
    normalized.length < 32 ||
    normalized.length >
      MAX_SECRET ||
    /\s/.test(normalized)
  ) {
    throw new Error(
      "Voice integrity secret must be 32+ non-whitespace characters",
    );
  }

  return normalized;
}

function bytesToBase64Url(
  bytes: Uint8Array,
): string {
  let binary = "";

  for (
    const byte of bytes
  ) {
    binary +=
      String.fromCharCode(
        byte,
      );
  }

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function base64UrlToBytes(
  value: string,
): Uint8Array {
  if (
    !/^[A-Za-z0-9_-]+$/.test(
      value,
    )
  ) {
    throw new Error(
      "Voice integrity value is malformed",
    );
  }

  const padded =
    value
      .replaceAll("-", "+")
      .replaceAll("_", "/")
      .padEnd(
        Math.ceil(
          value.length / 4,
        ) * 4,
        "=",
      );
  const binary =
    atob(padded);
  const bytes =
    new Uint8Array(
      binary.length,
    );

  for (
    let index = 0;
    index <
      binary.length;
    index += 1
  ) {
    bytes[index] =
      binary.charCodeAt(
        index,
      );
  }

  return bytes;
}

function exactObject(
  value: unknown,
  keys:
    readonly string[],
): Record<string, unknown> {
  if (
    !value ||
    typeof value !==
      "object" ||
    Array.isArray(value)
  ) {
    throw new Error(
      "Voice integrity payload is invalid",
    );
  }

  const record =
    value as Record<
      string,
      unknown
    >;
  const actual =
    Object.keys(record);

  if (
    actual.length !==
      keys.length ||
    actual.some(
      (key) =>
        !keys.includes(key),
    )
  ) {
    throw new Error(
      "Voice integrity payload fields are invalid",
    );
  }

  return record;
}

function stringField(
  value: unknown,
  label: string,
): string {
  if (
    typeof value !==
      "string" ||
    !value.trim() ||
    value.length > 512
  ) {
    throw new Error(
      `Voice integrity ${label} is invalid`,
    );
  }

  return value;
}

function timestamp(
  value: string,
  label: string,
): number {
  const parsed =
    Date.parse(value);

  if (
    !Number.isFinite(parsed)
  ) {
    throw new Error(
      `Voice integrity ${label} timestamp is invalid`,
    );
  }

  return parsed;
}

function sessionPayload(
  claims:
    VoiceSessionReceiptClaims,
): string {
  return JSON.stringify({
    version:
      VERSION,
    tenantId:
      claims.tenantId,
    actorId:
      claims.actorId,
    caseId:
      claims.caseId,
    subjectId:
      claims.subjectId,
    sessionId:
      claims.sessionId,
    issuedAt:
      claims.issuedAt,
    expiresAt:
      claims.expiresAt,
  });
}

function draftPayload(
  tenantId: string,
  draft:
    CommunicationDraft,
  metadata: {
    caseVersion: number;
    issuedAt: string;
    expiresAt: string;
  },
): string {
  return JSON.stringify({
    version:
      VERSION,
    tenantId,
    id:
      draft.id,
    caseId:
      draft.caseId,
    audience:
      draft.audience,
    channel:
      draft.channel,
    body:
      draft.body,
    requiresHumanApproval:
      draft.requiresHumanApproval,
    caseVersion:
      metadata.caseVersion,
    issuedAt:
      metadata.issuedAt,
    expiresAt:
      metadata.expiresAt,
  });
}

function positiveInteger(
  value: number,
  label: string,
): number {
  if (
    !Number.isSafeInteger(value) ||
    value < 1
  ) {
    throw new Error(
      `Voice integrity ${label} is invalid`,
    );
  }

  return value;
}

export class HmacVoiceIntegrity
implements VoiceIntegrity {
  readonly #key:
    Promise<CryptoKey>;

  constructor(
    secret: string,
  ) {
    const raw =
      new TextEncoder()
        .encode(
          requiredSecret(
            secret,
          ),
        );

    this.#key =
      crypto.subtle.importKey(
        "raw",
        raw,
        {
          name:
            "HMAC",
          hash:
            "SHA-256",
        },
        false,
        [
          "sign",
          "verify",
        ],
      );
  }

  async #sign(
    payload: string,
  ): Promise<string> {
    const signature =
      await crypto.subtle.sign(
        "HMAC",
        await this.#key,
        new TextEncoder()
          .encode(payload),
      );

    return bytesToBase64Url(
      new Uint8Array(
        signature,
      ),
    );
  }

  async #verify(
    payload: string,
    signature: string,
  ): Promise<boolean> {
    try {
      return await crypto.subtle
        .verify(
          "HMAC",
          await this.#key,
          Uint8Array.from(
            base64UrlToBytes(
              signature,
            ),
          ),
          new TextEncoder()
            .encode(
              payload,
            ),
        );
    } catch {
      return false;
    }
  }

  async issueSessionReceipt(
    input: {
      tenantId: string;
      actorId: string;
      caseId: string;
      subjectId: string;
      session:
        VoiceRealtimeSession;
    },
  ): Promise<string> {
    const claims = {
      tenantId:
        input.tenantId,
      actorId:
        input.actorId,
      caseId:
        input.caseId,
      subjectId:
        input.subjectId,
      sessionId:
        input.session
          .sessionId,
      issuedAt:
        input.session
          .issuedAt,
      expiresAt:
        input.session
          .expiresAt,
    };

    const payload =
      sessionPayload(
        claims,
      );
    const payloadEncoded =
      bytesToBase64Url(
        new TextEncoder()
          .encode(payload),
      );
    const signature =
      await this.#sign(
        payload,
      );

    return `${payloadEncoded}.${signature}`;
  }

  async verifySessionReceipt(
    input: {
      receipt: string;
      tenantId: string;
      actorId: string;
      caseId: string;
      subjectId: string;
      transcript:
        VoiceTranscriptEvidence;
      now: string;
    },
  ): Promise<void> {
    if (
      input.receipt.length >
        MAX_RECEIPT
    ) {
      throw new Error(
        "Voice session receipt is invalid",
      );
    }

    const parts =
      input.receipt
        .split(".");

    if (
      parts.length !== 2
    ) {
      throw new Error(
        "Voice session receipt is invalid",
      );
    }

    const payloadBytes =
      base64UrlToBytes(
        parts[0]!,
      );
    const payload =
      new TextDecoder()
        .decode(
          payloadBytes,
        );

    if (
      !await this.#verify(
        payload,
        parts[1]!,
      )
    ) {
      throw new Error(
        "Voice session receipt signature is invalid",
      );
    }

    let parsed: unknown;

    try {
      parsed =
        JSON.parse(
          payload,
        );
    } catch {
      throw new Error(
        "Voice session receipt payload is invalid",
      );
    }

    const record =
      exactObject(
        parsed,
        [
          "version",
          "tenantId",
          "actorId",
          "caseId",
          "subjectId",
          "sessionId",
          "issuedAt",
          "expiresAt",
        ],
      );

    if (
      record.version !==
        VERSION
    ) {
      throw new Error(
        "Voice session receipt version is invalid",
      );
    }

    const tenantId =
      stringField(
        record.tenantId,
        "tenantId",
      );
    const actorId =
      stringField(
        record.actorId,
        "actorId",
      );
    const caseId =
      stringField(
        record.caseId,
        "caseId",
      );
    const subjectId =
      stringField(
        record.subjectId,
        "subjectId",
      );
    const sessionId =
      stringField(
        record.sessionId,
        "sessionId",
      );
    const issuedAt =
      stringField(
        record.issuedAt,
        "issuedAt",
      );
    const expiresAt =
      stringField(
        record.expiresAt,
        "expiresAt",
      );

    if (
      tenantId !==
        input.tenantId ||
      actorId !==
        input.actorId ||
      caseId !==
        input.caseId ||
      subjectId !==
        input.subjectId
    ) {
      throw new Error(
        "Voice session receipt identity mismatch",
      );
    }

    const transcriptId =
      input.transcript
        .transcriptId;

    if (
      transcriptId !==
        sessionId &&
      !transcriptId.startsWith(
        `${sessionId}:`,
      )
    ) {
      throw new Error(
        "Voice transcript is not bound to the issued session",
      );
    }

    const issuedAtMs =
      timestamp(
        issuedAt,
        "issuedAt",
      );
    const expiresAtMs =
      timestamp(
        expiresAt,
        "expiresAt",
      );
    const capturedAtMs =
      timestamp(
        input.transcript
          .capturedAt,
        "capturedAt",
      );
    const nowMs =
      timestamp(
        input.now,
        "now",
      );

    if (
      expiresAtMs <=
        issuedAtMs ||
      capturedAtMs <
        issuedAtMs -
          CLOCK_SKEW_MS ||
      capturedAtMs >
        expiresAtMs +
          CLOCK_SKEW_MS ||
      nowMs >
        expiresAtMs +
          RECEIPT_GRACE_MS
    ) {
      throw new Error(
        "Voice session receipt timing is invalid",
      );
    }
  }

  async signCommunicationDraft(
    tenantId: string,
    draft:
      CommunicationDraft,
    context: {
      caseVersion: number;
      now: string;
    },
  ): Promise<
    SignedCommunicationDraft
  > {
    const caseVersion =
      positiveInteger(
        context.caseVersion,
        "caseVersion",
      );
    const issuedAtMs =
      timestamp(
        context.now,
        "draft issuedAt",
      );
    const issuedAt =
      new Date(
        issuedAtMs,
      ).toISOString();
    const expiresAt =
      new Date(
        issuedAtMs +
          DRAFT_TTL_MS,
      ).toISOString();
    const metadata = {
      caseVersion,
      issuedAt,
      expiresAt,
    };
    const payload =
      draftPayload(
        tenantId,
        draft,
        metadata,
      );

    return {
      ...draft,
      integrity: {
        version:
          VERSION,
        signature:
          await this.#sign(
            payload,
          ),
        ...metadata,
      },
    };
  }

  async verifyCommunicationDraft(
    tenantId: string,
    draft:
      SignedCommunicationDraft,
    now: string,
  ): Promise<
    VerifiedCommunicationDraft
  > {
    const metadata = {
      caseVersion:
        positiveInteger(
          draft.integrity
            .caseVersion,
          "caseVersion",
        ),
      issuedAt:
        stringField(
          draft.integrity
            .issuedAt,
          "draft issuedAt",
        ),
      expiresAt:
        stringField(
          draft.integrity
            .expiresAt,
          "draft expiresAt",
        ),
    };
    const issuedAtMs =
      timestamp(
        metadata.issuedAt,
        "draft issuedAt",
      );
    const expiresAtMs =
      timestamp(
        metadata.expiresAt,
        "draft expiresAt",
      );
    const nowMs =
      timestamp(
        now,
        "draft now",
      );

    if (
      expiresAtMs <=
        issuedAtMs ||
      nowMs <
        issuedAtMs -
          CLOCK_SKEW_MS ||
      nowMs >
        expiresAtMs
    ) {
      throw new Error(
        "Communication draft timing is invalid",
      );
    }

    if (
      draft.integrity
        .version !== VERSION ||
      !await this.#verify(
        draftPayload(
          tenantId,
          draft,
          metadata,
        ),
        draft.integrity
          .signature,
      )
    ) {
      throw new Error(
        "Communication draft integrity verification failed",
      );
    }

    const {
      integrity:
        _integrity,
      ...unsigned
    } = draft;

    return {
      draft:
        unsigned,
      ...metadata,
    };
  }
}
