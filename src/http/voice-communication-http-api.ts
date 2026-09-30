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
  OutboxStore,
} from "../outbox/types.ts";
import {
  OutboxDeliveryKeyConflictError,
} from "../outbox/errors.ts";
import type {
  StoredCase,
} from "../persistence/index.ts";
import {
  approveCommunication,
  assertCanUseVoiceOps,
  toCommunicationOutbox,
  type CommunicationDraft,
  type SignedCommunicationDraft,
  type VoiceIntegrity,
} from "../voice/index.ts";
import {
  readBoundedJson,
} from "./body.ts";

const MAX_ACCESS_TOKEN_LENGTH =
  8 * 1024;
const MAX_BODY_BYTES =
  32 * 1024;

export interface VoiceCommunicationGateway {
  operatorContext(input: {
    accessToken: string;
    tenantId: string;
  }): Promise<OperatorContextProjection>;

  get(input: {
    accessToken: string;
    tenantId: string;
    caseId: string;
  }): Promise<StoredCase | null>;
}

export interface VoiceCommunicationHttpApiOptions {
  gateway:
    VoiceCommunicationGateway;
  outbox:
    OutboxStore;
  integrity:
    VoiceIntegrity;
  now?: () => string;
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
    parts[6] !== "communications" ||
    parts[7] !== "approve"
  ) {
    return null;
  }

  let tenant: string;

  try {
    tenant =
      decodeURIComponent(
        parts[4]!,
      );
  } catch {
    return null;
  }

  return /^[A-Za-z0-9._:-]{1,128}$/.test(
    tenant,
  )
    ? tenant
    : null;
}

function draftFromBody(
  value: unknown,
): SignedCommunicationDraft {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error(
      "communication approval body must be an object",
    );
  }

  const body =
    value as Record<
      string,
      unknown
    >;

  if (
    Object.keys(body).length !== 1 ||
    !(
      "draft" in body
    )
  ) {
    throw new Error(
      "communication approval body must contain only draft",
    );
  }

  const raw =
    body.draft;

  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw)
  ) {
    throw new Error(
      "communication draft is invalid",
    );
  }

  const record =
    raw as Record<
      string,
      unknown
    >;

  const allowed = [
    "id",
    "caseId",
    "audience",
    "channel",
    "body",
    "requiresHumanApproval",
    "integrity",
  ];

  const keys =
    Object.keys(record);

  if (
    keys.length !==
      allowed.length ||
    keys.some(
      (key) =>
        !allowed.includes(key),
    )
  ) {
    throw new Error(
      "communication draft has unexpected or missing fields",
    );
  }

  if (
    typeof record.id !==
      "string" ||
    !record.id.trim() ||
    record.id.length > 512 ||
    typeof record.caseId !==
      "string" ||
    !/^[A-Za-z0-9._:-]{1,128}$/.test(
      record.caseId,
    ) ||
    (
      record.audience !==
        "supervisor" &&
      record.audience !==
        "family"
    ) ||
    record.channel !==
      "message" ||
    typeof record.body !==
      "string" ||
    !record.body.trim() ||
    record.body.length >
      8_000 ||
    record.requiresHumanApproval !==
      true ||
    !record.integrity ||
    typeof record.integrity !==
      "object" ||
    Array.isArray(
      record.integrity,
    )
  ) {
    throw new Error(
      "communication draft is invalid",
    );
  }

  const id =
    record.id.trim();
  const caseId =
    record.caseId;
  const audience =
    record.audience;

  const expectedPrefix =
    `${caseId}:${audience}:`;

  if (
    !id.startsWith(
      expectedPrefix,
    ) ||
    !/^[A-Za-z0-9._-]{1,32}$/.test(
      id.slice(
        expectedPrefix.length,
      ),
    )
  ) {
    throw new Error(
      "communication draft identity does not match case and audience",
    );
  }

  const integrity =
    record.integrity as Record<
      string,
      unknown
    >;

  if (
    Object.keys(integrity).length !==
      5 ||
    integrity.version !==
      "hmac-sha256-v1" ||
    typeof integrity.signature !==
      "string" ||
    !/^[A-Za-z0-9_-]{32,256}$/.test(
      integrity.signature,
    ) ||
    !Number.isSafeInteger(
      integrity.caseVersion,
    ) ||
    Number(
      integrity.caseVersion,
    ) < 1 ||
    typeof integrity.issuedAt !==
      "string" ||
    !Number.isFinite(
      Date.parse(
        integrity.issuedAt,
      ),
    ) ||
    typeof integrity.expiresAt !==
      "string" ||
    !Number.isFinite(
      Date.parse(
        integrity.expiresAt,
      ),
    )
  ) {
    throw new Error(
      "communication draft integrity is invalid",
    );
  }

  return {
    id,
    caseId,
    audience,
    channel:
      "message",
    body:
      record.body.trim(),
    requiresHumanApproval:
      true,
    integrity: {
      version:
        "hmac-sha256-v1",
      signature:
        integrity.signature,
      caseVersion:
        Number(
          integrity.caseVersion,
        ),
      issuedAt:
        integrity.issuedAt as string,
      expiresAt:
        integrity.expiresAt as string,
    },
  };
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

export class VoiceCommunicationHttpApi {
  readonly #gateway:
    VoiceCommunicationGateway;
  readonly #outbox:
    OutboxStore;
  readonly #integrity:
    VoiceIntegrity;
  readonly #now:
    () => string;

  constructor(
    options:
      VoiceCommunicationHttpApiOptions,
  ) {
    this.#gateway =
      options.gateway;
    this.#outbox =
      options.outbox;
    this.#integrity =
      options.integrity;
    this.#now =
      options.now ??
      (() =>
        new Date()
          .toISOString());
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
          "POST"
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
          "POST",
        );
        return response;
      }

      const accessToken =
        bearer(
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

      const draft =
        draftFromBody(
          await readBoundedJson(
            request,
            MAX_BODY_BYTES,
          ),
        );

      const now =
        this.#now();
      const verified =
        await this.#integrity
          .verifyCommunicationDraft(
            tenantId,
            draft,
            now,
          );

      const currentCase =
        await this.#gateway
          .get({
            accessToken,
            tenantId,
            caseId:
              verified.draft
                .caseId,
          });

      if (
        !currentCase ||
        currentCase.aggregate
          .version !==
          verified.caseVersion ||
        currentCase.aggregate
          .status ===
          "COMPLETED" ||
        currentCase.aggregate
          .status ===
          "CLOSED"
      ) {
        throw new Error(
          "Communication draft is stale for current Case state",
        );
      }

      const approved =
        approveCommunication(
          verified.draft,
          operator.actorId,
          now,
        );

      const enqueue =
        toCommunicationOutbox(
          tenantId,
          approved,
        );

      const queued =
        await this.#outbox
          .enqueue(
            enqueue,
          );

      return json(
        202,
        {
          queued: {
            id:
              queued.id,
            created:
              queued.created,
            deliveryKey:
              enqueue.deliveryKey,
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

      if (
        error instanceof
          OutboxDeliveryKeyConflictError
      ) {
        return json(
          409,
          {
            error: {
              code:
                "COMMUNICATION_ALREADY_APPROVED",
              message:
                "This communication draft has already been approved",
            },
          },
        );
      }

      return json(
        400,
        {
          error: {
            code:
              "COMMUNICATION_APPROVAL_REJECTED",
            message:
              "Communication approval rejected",
          },
        },
      );
    }
  }
}
