import {
  CaseAccessDeniedError,
} from "../access/errors.ts";
import type {
  OperatorContextProjection,
} from "../application/capabilities.ts";
import {
  AuthenticationError,
} from "../identity/types.ts";
import {
  assertCanUseVoiceOps,
  validateVoiceRealtimeSession,
  validateVoiceSessionRequest,
  type VoiceIntegrity,
  type VoiceRealtimeSessionIssuer,
} from "../voice/index.ts";
import {
  readBoundedJson,
} from "./body.ts";

const SAFE_IDENTIFIER =
  /^[A-Za-z0-9._:-]{1,128}$/;
const MAX_ACCESS_TOKEN_LENGTH =
  8 * 1024;
const DEFAULT_MAX_BODY_BYTES =
  4 * 1024;

export interface VoiceSessionGateway {
  operatorContext(input: {
    accessToken: string;
    tenantId: string;
  }): Promise<OperatorContextProjection>;
}

export interface VoiceSessionHttpApiOptions {
  gateway: VoiceSessionGateway;
  issuer: VoiceRealtimeSessionIssuer;
  integrity: VoiceIntegrity;
  now?: () => string;
  maxBodyBytes?: number;
}

function identifier(
  raw: string,
): string {
  let decoded: string;

  try {
    decoded =
      decodeURIComponent(raw);
  } catch {
    throw new Error(
      "invalid tenant identifier",
    );
  }

  if (
    !SAFE_IDENTIFIER.test(
      decoded,
    )
  ) {
    throw new Error(
      "invalid tenant identifier",
    );
  }

  return decoded;
}

function tenantFromUrl(
  request: Request,
): string | null {
  const parts =
    new URL(request.url)
      .pathname
      .split("/");

  if (
    parts.length !== 7 ||
    parts[0] !== "" ||
    parts[1] !== "api" ||
    parts[2] !== "care-ops" ||
    parts[3] !== "tenants" ||
    parts[5] !== "voice" ||
    parts[6] !== "session"
  ) {
    return null;
  }

  return identifier(
    parts[4]!,
  );
}

function bearerToken(
  request: Request,
): string {
  const header =
    request.headers.get(
      "authorization",
    );

  if (!header) {
    throw new AuthenticationError();
  }

  const match =
    /^Bearer ([^\s,]+)$/i.exec(
      header,
    );

  if (!match) {
    throw new AuthenticationError();
  }

  const token =
    match[1]!;

  if (
    token.length < 1 ||
    token.length >
      MAX_ACCESS_TOKEN_LENGTH
  ) {
    throw new AuthenticationError();
  }

  return token;
}

function sessionRequestFromBody(
  value: unknown,
): {
  caseId: string;
  subjectId: string;
  locale: string;
} {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error(
      "request body must be an object",
    );
  }

  const record =
    value as Record<
      string,
      unknown
    >;
  const allowed = [
    "caseId",
    "subjectId",
    "locale",
  ];

  if (
    Object.keys(record).length !==
      allowed.length ||
    Object.keys(record).some(
      (key) =>
        !allowed.includes(key),
    ) ||
    typeof record.caseId !==
      "string" ||
    typeof record.subjectId !==
      "string" ||
    typeof record.locale !==
      "string"
  ) {
    throw new Error(
      "request body must contain only caseId, subjectId and locale",
    );
  }

  return {
    caseId:
      identifier(
        encodeURIComponent(
          record.caseId,
        ),
      ),
    subjectId:
      identifier(
        encodeURIComponent(
          record.subjectId,
        ),
      ),
    locale:
      record.locale,
  };
}

function headers():
  Headers {
  return new Headers({
    "content-type":
      "application/json; charset=utf-8",
    "cache-control":
      "no-store",
    "x-content-type-options":
      "nosniff",
    "referrer-policy":
      "no-referrer",
  });
}

function response(
  status: number,
  body: unknown,
): Response {
  return new Response(
    JSON.stringify(body),
    {
      status,
      headers: headers(),
    },
  );
}

export class VoiceSessionHttpApi {
  readonly #gateway:
    VoiceSessionGateway;
  readonly #issuer:
    VoiceRealtimeSessionIssuer;
  readonly #integrity:
    VoiceIntegrity;
  readonly #now:
    () => string;
  readonly #maxBodyBytes:
    number;

  constructor(
    options:
      VoiceSessionHttpApiOptions,
  ) {
    this.#gateway =
      options.gateway;
    this.#issuer =
      options.issuer;
    this.#integrity =
      options.integrity;
    this.#now =
      options.now ??
      (() =>
        new Date()
          .toISOString());
    this.#maxBodyBytes =
      options.maxBodyBytes ??
      DEFAULT_MAX_BODY_BYTES;

    if (
      !Number.isInteger(
        this.#maxBodyBytes,
      ) ||
      this.#maxBodyBytes < 1
    ) {
      throw new Error(
        "maxBodyBytes must be positive",
      );
    }
  }

  async handle(
    request: Request,
  ): Promise<Response> {
    try {
      const tenantId =
        tenantFromUrl(
          request,
        );

      if (!tenantId) {
        return response(
          404,
          {
            error: {
              code:
                "ROUTE_NOT_FOUND",
              message:
                "Route not found",
            },
          },
        );
      }

      if (
        request.method !==
        "POST"
      ) {
        const result =
          response(
            405,
            {
              error: {
                code:
                  "METHOD_NOT_ALLOWED",
                message:
                  "Method not allowed",
              },
            },
          );
        result.headers.set(
          "allow",
          "POST",
        );
        return result;
      }

      const accessToken =
        bearerToken(
          request,
        );

      const operator =
        await this.#gateway
          .operatorContext({
            accessToken,
            tenantId,
          });

      assertCanUseVoiceOps(
        operator,
      );

      const body =
        sessionRequestFromBody(
          await readBoundedJson(
            request,
            this.#maxBodyBytes,
          ),
        );

      const sessionRequest =
        validateVoiceSessionRequest(
          {
            tenantId,
            actorId:
              operator.actorId,
            caseId:
              body.caseId,
            subjectId:
              body.subjectId,
            locale:
              body.locale,
          },
        );

      const issued =
        await this.#issuer
          .issue(
            sessionRequest,
          );

      const session =
        validateVoiceRealtimeSession(
          issued,
          this.#now(),
        );

      const evidenceReceipt =
        await this.#integrity
          .issueSessionReceipt({
            tenantId,
            actorId:
              operator.actorId,
            caseId:
              sessionRequest.caseId,
            subjectId:
              sessionRequest.subjectId,
            session,
          });

      return response(
        201,
        {
          session,
          evidenceReceipt,
        },
      );
    } catch (error) {
      if (
        error instanceof
          AuthenticationError
      ) {
        return response(
          401,
          {
            error: {
              code:
                "AUTHENTICATION_REQUIRED",
              message:
                "Authentication required",
            },
          },
        );
      }

      if (
        error instanceof
          CaseAccessDeniedError
      ) {
        return response(
          403,
          {
            error: {
              code:
                "FORBIDDEN",
              message:
                "Access denied",
            },
          },
        );
      }

      return response(
        400,
        {
          error: {
            code:
              "VOICE_SESSION_REJECTED",
            message:
              "Voice session request rejected",
          },
        },
      );
    }
  }
}
