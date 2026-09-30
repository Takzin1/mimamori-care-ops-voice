import {
  outboundAbortSignal,
  outboundTimeoutMs,
} from "../outbound.ts";
import {
  createSupabaseServerCredential,
  supabaseServerHeaders,
  type SupabaseServerCredential,
} from "../supabase/server-credential.ts";
import {
  CaseStoreCorruptionError,
  CaseStoreTransportError,
} from "../persistence/errors.ts";
import { OutboxDeliveryKeyConflictError } from "./errors.ts";
import type {
  ClaimOutboxInput,
  CompleteOutboxInput,
  EnqueueOutboxInput,
  EnqueueOutboxResult,
  FailOutboxInput,
  FailOutboxResult,
  OutboxMessage,
  OutboxStatus,
  OutboxStore,
} from "./types.ts";

type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface PostgrestOutboxStoreOptions {
  baseUrl: string;
  serverCredential?: SupabaseServerCredential;
  secretKey?: string;
  serviceRoleKey?: string;
  fetchImpl?: FetchLike;
  requestTimeoutMs?: number;
}

const OUTBOX_STATUSES = new Set<OutboxStatus>([
  "pending",
  "processing",
  "failed",
  "delivered",
  "dead_letter",
]);

function requireText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} is required`);
  }
  return normalized;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CaseStoreCorruptionError(
      "Outbox RPC returned invalid object",
    );
  }
  return value as Record<string, unknown>;
}

function asNumber(value: unknown, label: string): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value)
  ) {
    throw new CaseStoreCorruptionError(
      `Outbox RPC returned invalid ${label}`,
    );
  }
  return value;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) {
    throw new CaseStoreCorruptionError(
      `Outbox RPC returned invalid ${label}`,
    );
  }
  return value;
}

function nullableString(
  value: unknown,
  label: string,
): string | null {
  if (value === null || value === undefined) return null;
  return asString(value, label);
}

function asStatus(value: unknown): OutboxStatus {
  const status = asString(value, "status") as OutboxStatus;
  if (!OUTBOX_STATUSES.has(status)) {
    throw new CaseStoreCorruptionError(
      "Outbox RPC returned unknown status",
    );
  }
  return status;
}

function asMessage(value: unknown): OutboxMessage {
  const record = asRecord(value);

  return {
    id: asNumber(record.id, "id"),
    tenantId: asString(record.tenantId, "tenantId"),
    topic: asString(record.topic, "topic"),
    deliveryKey: asString(
      record.deliveryKey,
      "deliveryKey",
    ),
    payload: structuredClone(record.payload),
    status: asStatus(record.status),
    attemptCount: asNumber(
      record.attemptCount,
      "attemptCount",
    ),
    maxAttempts: asNumber(
      record.maxAttempts,
      "maxAttempts",
    ),
    availableAt: asString(
      record.availableAt,
      "availableAt",
    ),
    claimedAt: nullableString(
      record.claimedAt,
      "claimedAt",
    ),
    leaseUntil: nullableString(
      record.leaseUntil,
      "leaseUntil",
    ),
    workerId: nullableString(
      record.workerId,
      "workerId",
    ),
  };
}

export class PostgrestOutboxStore implements OutboxStore {
  private readonly baseUrl: string;
  private readonly serverCredential:
    SupabaseServerCredential;
  private readonly fetchImpl: FetchLike;
  private readonly requestTimeoutMs: number;

  constructor(options: PostgrestOutboxStoreOptions) {
    const baseUrl = requireText(
      options.baseUrl,
      "PostgREST base URL",
    );
    this.baseUrl = baseUrl.endsWith("/")
      ? baseUrl.slice(0, -1)
      : baseUrl;
    this.serverCredential =
      options.serverCredential ??
      createSupabaseServerCredential({
        secretKey: options.secretKey,
        serviceRoleKey:
          options.serviceRoleKey,
      });
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.requestTimeoutMs = outboundTimeoutMs(
      options.requestTimeoutMs,
    );
  }

  private rpcUrl(name: string): URL {
    return new URL(
      `${this.baseUrl}/rest/v1/rpc/${encodeURIComponent(name)}`,
    );
  }

  private async rpc(
    name: string,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    const headers =
      supabaseServerHeaders(
        this.serverCredential,
        {
          accept: "application/json",
          "content-type":
            "application/json",
          "accept-profile": "public",
          "content-profile": "public",
        },
      );

    let response: Response;
    try {
      response = await this.fetchImpl(
        this.rpcUrl(name),
        {
          method: "POST",
          signal: outboundAbortSignal(
            this.requestTimeoutMs,
          ),
          headers,
          body: JSON.stringify(body),
        },
      );
    } catch (error) {
      throw new CaseStoreTransportError(
        `Outbox request failed: ${error instanceof Error ? error.message : "network error"}`,
      );
    }

    const raw = await response.text();
    let payload: unknown = null;

    if (raw) {
      try {
        payload = JSON.parse(raw);
      } catch {
        throw new CaseStoreTransportError(
          "Outbox RPC returned non-JSON response",
          response.status,
        );
      }
    }

    if (!response.ok) {
      throw new CaseStoreTransportError(
        `Outbox RPC returned HTTP ${response.status}`,
        response.status,
      );
    }

    return payload;
  }

  async enqueue(
    input: EnqueueOutboxInput,
  ): Promise<EnqueueOutboxResult> {
    const body: Record<string, unknown> = {
      p_tenant_id: input.tenantId,
      p_topic: input.topic,
      p_delivery_key: input.deliveryKey,
      p_payload: input.payload,
    };

    if (input.availableAt) {
      body.p_available_at = input.availableAt;
    }
    if (input.maxAttempts !== undefined) {
      body.p_max_attempts = input.maxAttempts;
    }

    const record = asRecord(
      await this.rpc("enqueue_care_outbox", body),
    );

    if (
      record.conflict === true &&
      record.reason === "delivery_key_reuse"
    ) {
      throw new OutboxDeliveryKeyConflictError(
        input.tenantId,
        input.deliveryKey,
      );
    }

    if (record.ok !== true) {
      throw new CaseStoreCorruptionError(
        "enqueue_care_outbox returned unsuccessful payload",
      );
    }

    return {
      created: record.created === true,
      id: asNumber(record.id, "id"),
    };
  }

  async claim(
    input: ClaimOutboxInput,
  ): Promise<OutboxMessage[]> {
    const payload = await this.rpc(
      "claim_care_outbox",
      {
        p_tenant_id: input.tenantId,
        p_worker_id: input.workerId,
        p_limit: input.limit ?? 50,
        p_lease_seconds: input.leaseSeconds ?? 60,
      },
    );

    if (!Array.isArray(payload)) {
      throw new CaseStoreCorruptionError(
        "claim_care_outbox returned invalid payload",
      );
    }

    return payload.map(asMessage);
  }

  async complete(
    input: CompleteOutboxInput,
  ): Promise<boolean> {
    const record = asRecord(
      await this.rpc("complete_care_outbox", {
        p_tenant_id: input.tenantId,
        p_id: input.id,
        p_worker_id: input.workerId,
      }),
    );

    return record.ok === true;
  }

  async fail(
    input: FailOutboxInput,
  ): Promise<FailOutboxResult> {
    const body: Record<string, unknown> = {
      p_tenant_id: input.tenantId,
      p_id: input.id,
      p_worker_id: input.workerId,
      p_error: input.error,
    };

    if (input.retryAt) {
      body.p_retry_at = input.retryAt;
    }

    const record = asRecord(
      await this.rpc("fail_care_outbox", body),
    );

    return {
      ok: record.ok === true,
      status:
        record.status === null ||
        record.status === undefined
          ? null
          : asStatus(record.status),
    };
  }
}
