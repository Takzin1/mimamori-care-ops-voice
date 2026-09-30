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

type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface OutboxHealthCounts {
  pending: number;
  processing: number;
  failed: number;
  deadLetter: number;
  delivered: number | null;
}

export interface OutboxHealthSnapshot {
  tenantId: string;
  evaluatedAt: string;
  counts: OutboxHealthCounts;
  oldestActionableAt: string | null;
  oldestDeadLetterAt: string | null;
  maxAttemptCount: number;
}

export interface OutboxHealthMonitor {
  snapshot(
    tenantId: string,
    options?: {
      includeDelivered?: boolean;
    },
  ): Promise<OutboxHealthSnapshot>;
}

export interface PostgrestOutboxMonitorOptions {
  baseUrl: string;
  serverCredential?: SupabaseServerCredential;
  secretKey?: string;
  serviceRoleKey?: string;
  fetchImpl?: FetchLike;
  requestTimeoutMs?: number;
}

function requireText(
  value: string,
  label: string,
): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(
      `${label} is required`,
    );
  }
  return normalized;
}

function asRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new CaseStoreCorruptionError(
      `Outbox health returned invalid ${label}`,
    );
  }
  return value as Record<string, unknown>;
}

function asCount(
  value: unknown,
  label: string,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new CaseStoreCorruptionError(
      `Outbox health returned invalid ${label}`,
    );
  }
  return value;
}

function nullableCount(
  value: unknown,
  label: string,
): number | null {
  if (value === null) return null;
  return asCount(value, label);
}

function asTimestamp(
  value: unknown,
  label: string,
): string {
  if (
    typeof value !== "string" ||
    !value ||
    !Number.isFinite(
      Date.parse(value),
    )
  ) {
    throw new CaseStoreCorruptionError(
      `Outbox health returned invalid ${label}`,
    );
  }
  return value;
}

function nullableTimestamp(
  value: unknown,
  label: string,
): string | null {
  if (value === null) return null;
  return asTimestamp(value, label);
}

function parseSnapshot(
  value: unknown,
): OutboxHealthSnapshot {
  const record =
    asRecord(value, "snapshot");
  const counts =
    asRecord(
      record.counts,
      "counts",
    );

  return {
    tenantId: requireText(
      typeof record.tenantId === "string"
        ? record.tenantId
        : "",
      "tenantId",
    ),
    evaluatedAt: asTimestamp(
      record.evaluatedAt,
      "evaluatedAt",
    ),
    counts: {
      pending: asCount(
        counts.pending,
        "pending count",
      ),
      processing: asCount(
        counts.processing,
        "processing count",
      ),
      failed: asCount(
        counts.failed,
        "failed count",
      ),
      deadLetter: asCount(
        counts.deadLetter,
        "dead-letter count",
      ),
      delivered: nullableCount(
        counts.delivered,
        "delivered count",
      ),
    },
    oldestActionableAt:
      nullableTimestamp(
        record.oldestActionableAt,
        "oldestActionableAt",
      ),
    oldestDeadLetterAt:
      nullableTimestamp(
        record.oldestDeadLetterAt,
        "oldestDeadLetterAt",
      ),
    maxAttemptCount: asCount(
      record.maxAttemptCount,
      "maxAttemptCount",
    ),
  };
}

export class PostgrestOutboxMonitor
implements OutboxHealthMonitor {
  readonly #baseUrl: string;
  readonly #serverCredential:
    SupabaseServerCredential;
  readonly #fetchImpl: FetchLike;
  readonly #requestTimeoutMs: number;

  constructor(
    options:
      PostgrestOutboxMonitorOptions,
  ) {
    const baseUrl = requireText(
      options.baseUrl,
      "PostgREST base URL",
    );
    this.#baseUrl =
      baseUrl.endsWith("/")
        ? baseUrl.slice(0, -1)
        : baseUrl;
    this.#serverCredential =
      options.serverCredential ??
      createSupabaseServerCredential({
        secretKey: options.secretKey,
        serviceRoleKey:
          options.serviceRoleKey,
      });
    this.#fetchImpl =
      options.fetchImpl ?? fetch;
    this.#requestTimeoutMs =
      outboundTimeoutMs(
        options.requestTimeoutMs,
      );
  }

  async snapshot(
    tenantId: string,
    options: {
      includeDelivered?: boolean;
    } = {},
  ): Promise<OutboxHealthSnapshot> {
    const tenant =
      requireText(
        tenantId,
        "tenantId",
      );

    const headers =
      supabaseServerHeaders(
        this.#serverCredential,
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
      response =
        await this.#fetchImpl(
          new URL(
            `${this.#baseUrl}/rest/v1/rpc/get_care_outbox_health`,
          ),
          {
            method: "POST",
            headers,
            signal:
              outboundAbortSignal(
                this.#requestTimeoutMs,
              ),
            body: JSON.stringify({
              p_tenant_id: tenant,
              p_include_delivered:
                options.includeDelivered ===
                true,
            }),
          },
        );
    } catch {
      throw new CaseStoreTransportError(
        "Outbox health request failed",
      );
    }

    const raw =
      await response.text();

    if (!response.ok) {
      throw new CaseStoreTransportError(
        `Outbox health request returned HTTP ${response.status}`,
        response.status,
      );
    }

    let payload: unknown;

    try {
      payload = JSON.parse(raw);
    } catch {
      throw new CaseStoreTransportError(
        "Outbox health request returned non-JSON response",
        response.status,
      );
    }

    const snapshot =
      parseSnapshot(payload);

    if (
      snapshot.tenantId !== tenant
    ) {
      throw new CaseStoreCorruptionError(
        "Outbox health tenant mismatch",
      );
    }

    return snapshot;
  }
}
