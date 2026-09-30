import type {
  OutboxDeliveryHandler,
  OutboxMessage,
} from "../outbox/types.ts";
import type {
  CommunicationAudience,
} from "./types.ts";

export const COMMUNICATION_OUTBOX_TOPIC =
  "care_ops.communication";

export interface ApprovedCommunicationDelivery {
  tenantId: string;
  deliveryKey: string;
  caseId: string;
  audience:
    CommunicationAudience;
  channel: "message";
  body: string;
  approvedBy: string;
  approvedAt: string;
}

export interface ApprovedCommunicationSender {
  send(
    input:
      ApprovedCommunicationDelivery,
  ): Promise<void>;
}

function requiredText(
  value: unknown,
  label: string,
  max = 8_000,
): string {
  if (
    typeof value !== "string"
  ) {
    throw new Error(
      `communication ${label} must be text`,
    );
  }

  const normalized =
    value.trim();

  if (
    !normalized ||
    normalized.length > max
  ) {
    throw new Error(
      `communication ${label} is invalid`,
    );
  }

  return normalized;
}

function safeId(
  value: unknown,
  label: string,
): string {
  const normalized =
    requiredText(
      value,
      label,
      128,
    );

  if (
    !/^[A-Za-z0-9._:-]+$/.test(
      normalized,
    )
  ) {
    throw new Error(
      `communication ${label} is invalid`,
    );
  }

  return normalized;
}

function parsePayload(
  message:
    OutboxMessage,
): ApprovedCommunicationDelivery {
  if (
    message.topic !==
      COMMUNICATION_OUTBOX_TOPIC
  ) {
    throw new Error(
      "communication handler received wrong topic",
    );
  }

  if (
    !message.payload ||
    typeof message.payload !==
      "object" ||
    Array.isArray(
      message.payload,
    )
  ) {
    throw new Error(
      "communication payload is invalid",
    );
  }

  const payload =
    message.payload as Record<
      string,
      unknown
    >;

  const allowed = [
    "caseId",
    "audience",
    "channel",
    "body",
    "approvedBy",
    "approvedAt",
  ];

  const keys =
    Object.keys(payload);

  if (
    keys.length !==
      allowed.length ||
    keys.some(
      (key) =>
        !allowed.includes(key),
    )
  ) {
    throw new Error(
      "communication payload has unexpected or missing fields",
    );
  }

  if (
    payload.audience !==
      "supervisor" &&
    payload.audience !==
      "family"
  ) {
    throw new Error(
      "communication audience is invalid",
    );
  }

  if (
    payload.channel !==
      "message"
  ) {
    throw new Error(
      "communication channel is invalid",
    );
  }

  const approvedAt =
    requiredText(
      payload.approvedAt,
      "approvedAt",
      64,
    );

  if (
    !Number.isFinite(
      Date.parse(
        approvedAt,
      ),
    )
  ) {
    throw new Error(
      "communication approvedAt is invalid",
    );
  }

  return {
    tenantId:
      safeId(
        message.tenantId,
        "tenantId",
      ),
    deliveryKey:
      requiredText(
        message.deliveryKey,
        "deliveryKey",
        512,
      ),
    caseId:
      safeId(
        payload.caseId,
        "caseId",
      ),
    audience:
      payload.audience,
    channel:
      "message",
    body:
      requiredText(
        payload.body,
        "body",
      ),
    approvedBy:
      safeId(
        payload.approvedBy,
        "approvedBy",
      ),
    approvedAt,
  };
}

export class ApprovedCommunicationOutboxHandler
implements OutboxDeliveryHandler {
  readonly topic =
    COMMUNICATION_OUTBOX_TOPIC;

  readonly #sender:
    ApprovedCommunicationSender;

  constructor(
    sender:
      ApprovedCommunicationSender,
  ) {
    this.#sender =
      sender;
  }

  async deliver(
    message:
      OutboxMessage,
  ): Promise<void> {
    const approved =
      parsePayload(
        message,
      );

    await this.#sender.send(
      approved,
    );
  }
}
