import {
  outboundAbortSignal,
  outboundTimeoutMs,
} from "../outbound.ts";
import type {
  ApprovedCommunicationDelivery,
  ApprovedCommunicationSender,
} from "./communication-delivery.ts";

type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface CommunicationWebhookTarget {
  url: string;
  headers?: Readonly<
    Record<string, string>
  >;
}

export interface CommunicationWebhookResolver {
  resolve(
    input: Readonly<{
      tenantId: string;
      caseId: string;
      audience:
        ApprovedCommunicationDelivery["audience"];
    }>,
  ): Promise<CommunicationWebhookTarget>;
}

export interface WebhookCommunicationSenderOptions {
  resolver:
    CommunicationWebhookResolver;
  fetchImpl?: FetchLike;
  requestTimeoutMs?: number;
}

function secureWebhookUrl(
  value: string,
): URL {
  let url: URL;

  try {
    url =
      new URL(value);
  } catch {
    throw new Error(
      "communication webhook URL is invalid",
    );
  }

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new Error(
      "communication webhook must be credential-free HTTPS",
    );
  }

  return url;
}

export class WebhookCommunicationSender
implements ApprovedCommunicationSender {
  readonly #resolver:
    CommunicationWebhookResolver;
  readonly #fetchImpl:
    FetchLike;
  readonly #timeoutMs:
    number;

  constructor(
    options:
      WebhookCommunicationSenderOptions,
  ) {
    this.#resolver =
      options.resolver;
    this.#fetchImpl =
      options.fetchImpl ??
      fetch;
    this.#timeoutMs =
      outboundTimeoutMs(
        options.requestTimeoutMs,
      );
  }

  async send(
    input:
      ApprovedCommunicationDelivery,
  ): Promise<void> {
    const target =
      await this.#resolver
        .resolve({
          tenantId:
            input.tenantId,
          caseId:
            input.caseId,
          audience:
            input.audience,
        });

    const url =
      secureWebhookUrl(
        target.url,
      );

    const headers =
      new Headers(
        target.headers,
      );

    headers.set(
      "accept",
      "application/json",
    );
    headers.set(
      "content-type",
      "application/json",
    );
    headers.set(
      "idempotency-key",
      input.deliveryKey,
    );

    const response =
      await this.#fetchImpl(
        url,
        {
          method: "POST",
          headers,
          signal:
            outboundAbortSignal(
              this.#timeoutMs,
            ),
          body:
            JSON.stringify({
              tenantId:
                input.tenantId,
              caseId:
                input.caseId,
              audience:
                input.audience,
              channel:
                input.channel,
              body:
                input.body,
              approvedBy:
                input.approvedBy,
              approvedAt:
                input.approvedAt,
              deliveryKey:
                input.deliveryKey,
            }),
          cache: "no-store",
          credentials:
            "omit",
          redirect:
            "error",
          referrerPolicy:
            "no-referrer",
        },
      );

    if (
      !response.ok
    ) {
      throw new Error(
        `communication webhook returned HTTP ${response.status}`,
      );
    }
  }
}
