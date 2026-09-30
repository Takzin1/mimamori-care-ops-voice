import {
  CaseAccessDeniedError,
} from "../access/errors.ts";
import type {
  OperatorContextProjection,
} from "../application/capabilities.ts";
import {
  AuthenticationError,
} from "../identity/types.ts";
import type {
  OutboxHealthMonitor,
} from "../outbox/monitor.ts";

const MAX_ACCESS_TOKEN_LENGTH =
  8 * 1024;
const SAFE_IDENTIFIER =
  /^[A-Za-z0-9._:-]{1,128}$/;

export interface VoiceOutboxHealthGateway {
  operatorContext(input: {
    accessToken: string;
    tenantId: string;
  }): Promise<OperatorContextProjection>;
}

export interface VoiceOutboxHealthHttpApiOptions {
  gateway:
    VoiceOutboxHealthGateway;
  monitor:
    OutboxHealthMonitor;
}

function bearer(
  request: Request,
): string {
  const header =
    request.headers.get(
      "authorization",
    );
  const match =
    header
      ? /^Bearer ([^\s,]+)$/i.exec(
          header,
        )
      : null;

  if (
    !match ||
    match[1]!.length >
      MAX_ACCESS_TOKEN_LENGTH
  ) {
    throw new AuthenticationError();
  }

  return match[1]!;
}

function tenantFromPath(
  request: Request,
): string | null {
  const parts =
    new URL(request.url)
      .pathname
      .split("/");

  if (
    parts.length !== 8 ||
    parts[0] !== "" ||
    parts[1] !== "api" ||
    parts[2] !== "care-ops" ||
    parts[3] !== "tenants" ||
    parts[5] !== "voice" ||
    parts[6] !== "outbox" ||
    parts[7] !== "health"
  ) {
    return null;
  }

  let tenantId: string;

  try {
    tenantId =
      decodeURIComponent(
        parts[4]!,
      );
  } catch {
    return null;
  }

  return SAFE_IDENTIFIER.test(
    tenantId,
  )
    ? tenantId
    : null;
}

function json(
  status: number,
  body: unknown,
): Response {
  return new Response(
    JSON.stringify(body),
    {
      status,
      headers: {
        "content-type":
          "application/json; charset=utf-8",
        "cache-control":
          "no-store",
        "x-content-type-options":
          "nosniff",
        "referrer-policy":
          "no-referrer",
      },
    },
  );
}

export class VoiceOutboxHealthHttpApi {
  readonly #gateway:
    VoiceOutboxHealthGateway;
  readonly #monitor:
    OutboxHealthMonitor;

  constructor(
    options:
      VoiceOutboxHealthHttpApiOptions,
  ) {
    this.#gateway =
      options.gateway;
    this.#monitor =
      options.monitor;
  }

  async handle(
    request: Request,
  ): Promise<Response> {
    try {
      const tenantId =
        tenantFromPath(
          request,
        );

      if (!tenantId) {
        return json(
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
          "GET"
      ) {
        const response =
          json(
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
        response.headers.set(
          "allow",
          "GET",
        );
        return response;
      }

      const accessToken =
        bearer(
          request,
        );

      await this.#gateway
        .operatorContext({
          accessToken,
          tenantId,
        });

      const snapshot =
        await this.#monitor
          .snapshot(
            tenantId,
            {
              includeDelivered:
                true,
            },
          );

      return json(
        200,
        {
          outbox: {
            evaluatedAt:
              snapshot.evaluatedAt,
            counts: {
              pending:
                snapshot.counts
                  .pending,
              processing:
                snapshot.counts
                  .processing,
              failed:
                snapshot.counts
                  .failed,
              deadLetter:
                snapshot.counts
                  .deadLetter,
              delivered:
                snapshot.counts
                  .delivered ?? 0,
            },
            oldestActionableAt:
              snapshot
                .oldestActionableAt,
            maxAttemptCount:
              snapshot
                .maxAttemptCount,
          },
        },
      );
    } catch (error) {
      if (
        error instanceof
          AuthenticationError
      ) {
        return json(
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
        return json(
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

      return json(
        503,
        {
          error: {
            code:
              "OUTBOX_HEALTH_UNAVAILABLE",
            message:
              "Outbox health is unavailable",
          },
        },
      );
    }
  }
}
