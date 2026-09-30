import type {
  AccessTokenProvider,
} from "./types.ts";
import {
  validateVoiceRealtimeSession,
  type VoiceRealtimeSession,
} from "../voice/index.ts";

const SAFE_IDENTIFIER =
  /^[A-Za-z0-9._:-]{1,128}$/;
const MAX_ACCESS_TOKEN_LENGTH =
  8 * 1024;

export interface VoiceSessionHttpClientOptions {
  baseUrl: string;
  accessTokenProvider:
    AccessTokenProvider;
  fetchImpl?: typeof fetch;
  now?: () => string;
}

function origin(
  value: string,
): string {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error(
      "Voice session base URL must be absolute",
    );
  }

  if (
    url.protocol !== "https:" &&
    url.protocol !== "http:"
  ) {
    throw new Error(
      "Voice session base URL must use http or https",
    );
  }

  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (
      url.pathname &&
      url.pathname !== "/"
    )
  ) {
    throw new Error(
      "Voice session base URL must be an origin",
    );
  }

  return url.origin;
}

function identifier(
  value: string,
  label: string,
): string {
  if (
    !SAFE_IDENTIFIER.test(
      value,
    )
  ) {
    throw new Error(
      `${label} is invalid`,
    );
  }

  return value;
}

function accessToken(
  value: string,
): string {
  if (
    value.length < 1 ||
    value.length >
      MAX_ACCESS_TOKEN_LENGTH ||
    !/^[^\s,]+$/.test(value)
  ) {
    throw new Error(
      "access token is invalid",
    );
  }

  return value;
}

function locale(
  value: string,
): string {
  const normalized =
    value.trim();

  if (
    normalized.length < 2 ||
    normalized.length > 64 ||
    !/^[A-Za-z0-9-]+$/.test(
      normalized,
    )
  ) {
    throw new Error(
      "locale is invalid",
    );
  }

  return normalized;
}

export class VoiceSessionHttpClient {
  readonly #baseUrl: string;
  readonly #accessTokenProvider:
    AccessTokenProvider;
  readonly #fetchImpl:
    typeof fetch;
  readonly #now:
    () => string;

  constructor(
    options:
      VoiceSessionHttpClientOptions,
  ) {
    this.#baseUrl =
      origin(
        options.baseUrl,
      );
    this.#accessTokenProvider =
      options.accessTokenProvider;
    this.#fetchImpl =
      options.fetchImpl ??
      fetch;
    this.#now =
      options.now ??
      (() =>
        new Date()
          .toISOString());
  }

  async issue(input: {
    tenantId: string;
    caseId: string;
    subjectId: string;
    locale: string;
  }): Promise<VoiceRealtimeSession> {
    const tenantId =
      identifier(
        input.tenantId,
        "tenantId",
      );
    const caseId =
      identifier(
        input.caseId,
        "caseId",
      );
    const subjectId =
      identifier(
        input.subjectId,
        "subjectId",
      );
    const preferredLocale =
      locale(
        input.locale,
      );
    const token =
      accessToken(
        await this
          .#accessTokenProvider(),
      );

    const response =
      await this.#fetchImpl(
        new URL(
          `/api/care-ops/tenants/${encodeURIComponent(tenantId)}/voice/session`,
          this.#baseUrl,
        ),
        {
          method: "POST",
          headers: {
            accept:
              "application/json",
            authorization:
              `Bearer ${token}`,
            "content-type":
              "application/json",
          },
          body: JSON.stringify({
            caseId,
            subjectId,
            locale:
              preferredLocale,
          }),
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
        "Voice session response is not JSON",
      );
    }

    const value =
      await response.json() as {
        session?: VoiceRealtimeSession;
        error?: {
          code?: string;
          message?: string;
        };
      };

    if (
      !response.ok
    ) {
      throw new Error(
        value.error?.message ??
          "Voice session request failed",
      );
    }

    if (!value.session) {
      throw new Error(
        "Voice session response is missing session",
      );
    }

    return validateVoiceRealtimeSession(
      value.session,
      this.#now(),
    );
  }
}
