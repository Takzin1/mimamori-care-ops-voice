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
  CaseConflictError,
} from "../core/errors.ts";
import {
  applyEvent,
  replayCase,
} from "../core/case-core.ts";
import type {
  CaseAggregate,
  CaseCreatedEvent,
  CaseEvent,
} from "../core/types.ts";
import {
  CaseNotFoundError,
  CaseStoreCorruptionError,
  CaseStoreTransportError,
  DuplicateCaseError,
  SignalReplayMismatchError,
} from "./errors.ts";
import type {
  AppendCaseEventInput,
  CaseRepository,
  CreateCaseResult,
  StoredCase,
} from "./types.ts";

type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface PostgrestCaseRepositoryOptions {
  baseUrl: string;
  serverCredential?: SupabaseServerCredential;
  secretKey?: string;
  serviceRoleKey?: string;
  fetchImpl?: FetchLike;
  pageSize?: number;
  requestTimeoutMs?: number;
}

interface CaseRow {
  case_id: string;
  snapshot: unknown;
}

interface EventRow {
  case_id: string;
  sequence: number;
  event: unknown;
}

interface CreateRpcResult {
  ok?: boolean;
  created?: boolean;
  conflict?: boolean;
  reason?: string;
  caseId?: string;
  version?: number;
  snapshot?: unknown;
}

interface AppendRpcResult {
  ok?: boolean;
  notFound?: boolean;
  conflict?: boolean;
  currentVersion?: number;
  version?: number;
}

function requireText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} is required`);
  }
  return normalized;
}

function normalizeBaseUrl(value: string): string {
  const normalized = requireText(value, "PostgREST base URL");
  return normalized.endsWith("/")
    ? normalized.slice(0, -1)
    : normalized;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([key, item]) =>
          `${JSON.stringify(key)}:${stableJson(item)}`,
      );

    return `{${entries.join(",")}}`;
  }

  return JSON.stringify(value) ?? "undefined";
}

function asAggregate(value: unknown): CaseAggregate {
  if (!value || typeof value !== "object") {
    throw new CaseStoreCorruptionError(
      "Stored Case snapshot is not an object",
    );
  }

  return structuredClone(value) as CaseAggregate;
}

function asEvent(value: unknown): CaseEvent {
  if (!value || typeof value !== "object") {
    throw new CaseStoreCorruptionError(
      "Stored Case event is not an object",
    );
  }

  return structuredClone(value) as CaseEvent;
}

function validateStoredCase(
  tenantId: string,
  caseId: string,
  snapshotValue: unknown,
  eventValues: readonly unknown[],
): StoredCase {
  const aggregate = asAggregate(snapshotValue);
  const events = eventValues.map(asEvent);

  if (
    aggregate.tenantId !== tenantId ||
    aggregate.id !== caseId
  ) {
    throw new CaseStoreCorruptionError(
      `Stored Case identity mismatch: ${tenantId}/${caseId}`,
    );
  }

  if (events.length === 0) {
    throw new CaseStoreCorruptionError(
      `Stored Case has no event stream: ${tenantId}/${caseId}`,
    );
  }

  let replayed: CaseAggregate;
  try {
    replayed = replayCase(events);
  } catch (error) {
    throw new CaseStoreCorruptionError(
      `Stored Case event stream cannot be replayed: ${tenantId}/${caseId}; ${error instanceof Error ? error.message : "unknown replay error"}`,
    );
  }

  if (stableJson(replayed) !== stableJson(aggregate)) {
    throw new CaseStoreCorruptionError(
      `Stored Case snapshot/event divergence: ${tenantId}/${caseId}`,
    );
  }

  return {
    aggregate,
    events,
  };
}

function isCreateRpcResult(value: unknown): value is CreateRpcResult {
  return Boolean(value && typeof value === "object");
}

function isAppendRpcResult(value: unknown): value is AppendRpcResult {
  return Boolean(value && typeof value === "object");
}

export class PostgrestCaseRepository implements CaseRepository {
  private readonly baseUrl: string;
  private readonly serverCredential:
    SupabaseServerCredential;
  private readonly fetchImpl: FetchLike;
  private readonly pageSize: number;
  private readonly requestTimeoutMs: number;

  constructor(options: PostgrestCaseRepositoryOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.serverCredential =
      options.serverCredential ??
      createSupabaseServerCredential({
        secretKey: options.secretKey,
        serviceRoleKey:
          options.serviceRoleKey,
      });
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.pageSize = options.pageSize ?? 500;
    this.requestTimeoutMs = outboundTimeoutMs(
      options.requestTimeoutMs,
    );

    if (
      !Number.isInteger(this.pageSize) ||
      this.pageSize < 1 ||
      this.pageSize > 1000
    ) {
      throw new Error("pageSize must be an integer between 1 and 1000");
    }
  }

  private headers(): HeadersInit {
    return supabaseServerHeaders(
      this.serverCredential,
      {
        accept: "application/json",
        "content-type":
          "application/json",
        "accept-profile": "public",
        "content-profile": "public",
      },
    );
  }

  private async requestJson(
    url: URL,
    init: RequestInit = {},
  ): Promise<unknown> {
    let response: Response;

    try {
      const headers = new Headers(this.headers());
      if (init.headers) {
        const override = new Headers(init.headers);
        override.forEach((value, key) => {
          headers.set(key, value);
        });
      }

      response = await this.fetchImpl(url, {
        ...init,
        headers,
        signal:
          init.signal ??
          outboundAbortSignal(
            this.requestTimeoutMs,
          ),
      });
    } catch (error) {
      throw new CaseStoreTransportError(
        `Case Store request failed: ${error instanceof Error ? error.message : "network error"}`,
      );
    }

    const raw = await response.text();
    let body: unknown = null;

    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        throw new CaseStoreTransportError(
          "Case Store returned non-JSON response",
          response.status,
        );
      }
    }

    if (!response.ok) {
      throw new CaseStoreTransportError(
        `Case Store returned HTTP ${response.status}`,
        response.status,
      );
    }

    return body;
  }

  private rpcUrl(name: string): URL {
    return new URL(
      `${this.baseUrl}/rest/v1/rpc/${encodeURIComponent(name)}`,
    );
  }

  private tableUrl(table: string): URL {
    return new URL(
      `${this.baseUrl}/rest/v1/${encodeURIComponent(table)}`,
    );
  }

  private async fetchAllRows<T>(
    makeUrl: (offset: number, limit: number) => URL,
  ): Promise<T[]> {
    const rows: T[] = [];

    for (let offset = 0; ; offset += this.pageSize) {
      const body = await this.requestJson(
        makeUrl(offset, this.pageSize),
        { method: "GET" },
      );

      if (!Array.isArray(body)) {
        throw new CaseStoreCorruptionError(
          "Case Store list response is not an array",
        );
      }

      rows.push(...(body as T[]));

      if (body.length < this.pageSize) {
        break;
      }
    }

    return rows;
  }

  private async loadCaseRows(
    tenantId: string,
    caseId?: string,
  ): Promise<CaseRow[]> {
    return this.fetchAllRows<CaseRow>((offset, limit) => {
      const url = this.tableUrl("care_cases");
      url.searchParams.set("select", "case_id,snapshot");
      url.searchParams.set("tenant_id", `eq.${tenantId}`);
      if (caseId) {
        url.searchParams.set("case_id", `eq.${caseId}`);
      }
      url.searchParams.set("order", "case_id.asc");
      url.searchParams.set("limit", String(limit));
      url.searchParams.set("offset", String(offset));
      return url;
    });
  }

  private async loadEventRows(
    tenantId: string,
    caseId?: string,
  ): Promise<EventRow[]> {
    return this.fetchAllRows<EventRow>((offset, limit) => {
      const url = this.tableUrl("care_case_events");
      url.searchParams.set(
        "select",
        "case_id,sequence,event",
      );
      url.searchParams.set("tenant_id", `eq.${tenantId}`);
      if (caseId) {
        url.searchParams.set("case_id", `eq.${caseId}`);
      }
      url.searchParams.set(
        "order",
        "case_id.asc,sequence.asc",
      );
      url.searchParams.set("limit", String(limit));
      url.searchParams.set("offset", String(offset));
      return url;
    });
  }

  async create(
    event: CaseCreatedEvent,
  ): Promise<CreateCaseResult> {
    const aggregate = replayCase([event]);

    let body: unknown;
    try {
      body = await this.requestJson(
        this.rpcUrl("create_care_case"),
        {
          method: "POST",
          body: JSON.stringify({
            p_snapshot: aggregate,
            p_event: event,
          }),
        },
      );
    } catch (error) {
      if (
        error instanceof CaseStoreTransportError &&
        error.status === 409
      ) {
        throw new DuplicateCaseError(
          event.data.tenantId,
          event.data.caseId,
        );
      }
      throw error;
    }

    if (!isCreateRpcResult(body)) {
      throw new CaseStoreCorruptionError(
        "create_care_case returned invalid payload",
      );
    }

    if (
      body.conflict &&
      body.reason === "signal_replay_mismatch"
    ) {
      throw new SignalReplayMismatchError(
        event.data.tenantId,
        event.data.sourceAdapter,
        event.data.sourceSignalId,
      );
    }

    if (!body.ok || !body.caseId) {
      throw new CaseStoreCorruptionError(
        "create_care_case returned unsuccessful payload",
      );
    }

    const stored = await this.load(
      event.data.tenantId,
      body.caseId,
    );

    if (!stored) {
      throw new CaseStoreCorruptionError(
        "create_care_case succeeded but Case cannot be loaded",
      );
    }

    const original = stored.events[0];
    if (!original || original.type !== "case_created") {
      throw new CaseStoreCorruptionError(
        "Stored Case is missing case_created event",
      );
    }

    return {
      aggregate: stored.aggregate,
      event: original,
      created: body.created === true,
    };
  }

  async load(
    tenantId: string,
    caseId: string,
  ): Promise<StoredCase | null> {
    const [caseRows, eventRows] = await Promise.all([
      this.loadCaseRows(tenantId, caseId),
      this.loadEventRows(tenantId, caseId),
    ]);

    if (caseRows.length === 0) {
      if (eventRows.length > 0) {
        throw new CaseStoreCorruptionError(
          `Events exist without Case snapshot: ${tenantId}/${caseId}`,
        );
      }
      return null;
    }

    if (caseRows.length !== 1) {
      throw new CaseStoreCorruptionError(
        `Duplicate Case rows detected: ${tenantId}/${caseId}`,
      );
    }

    const row = caseRows[0]!;
    return validateStoredCase(
      tenantId,
      caseId,
      row.snapshot,
      eventRows.map((item) => item.event),
    );
  }

  async list(tenantId: string): Promise<StoredCase[]> {
    const [caseRows, eventRows] = await Promise.all([
      this.loadCaseRows(tenantId),
      this.loadEventRows(tenantId),
    ]);

    const eventsByCase = new Map<string, unknown[]>();
    for (const row of eventRows) {
      const bucket = eventsByCase.get(row.case_id) ?? [];
      bucket.push(row.event);
      eventsByCase.set(row.case_id, bucket);
    }

    const result = caseRows.map((row) =>
      validateStoredCase(
        tenantId,
        row.case_id,
        row.snapshot,
        eventsByCase.get(row.case_id) ?? [],
      ),
    );

    const knownCaseIds = new Set(
      caseRows.map((row) => row.case_id),
    );
    const orphaned = eventRows.find(
      (row) => !knownCaseIds.has(row.case_id),
    );
    if (orphaned) {
      throw new CaseStoreCorruptionError(
        `Events exist without Case snapshot: ${tenantId}/${orphaned.case_id}`,
      );
    }

    return result;
  }

  async append(
    input: AppendCaseEventInput,
  ): Promise<CaseAggregate> {
    const current = await this.load(
      input.tenantId,
      input.caseId,
    );

    if (!current) {
      throw new CaseNotFoundError(
        input.tenantId,
        input.caseId,
      );
    }

    if (current.aggregate.version !== input.expectedVersion) {
      throw new CaseConflictError(
        input.expectedVersion,
        current.aggregate.version,
      );
    }

    const next = applyEvent(
      current.aggregate,
      input.event,
    );

    const body = await this.requestJson(
      this.rpcUrl("append_care_case_event"),
      {
        method: "POST",
        body: JSON.stringify({
          p_tenant_id: input.tenantId,
          p_case_id: input.caseId,
          p_expected_version: input.expectedVersion,
          p_snapshot: next,
          p_event: input.event,
        }),
      },
    );

    if (!isAppendRpcResult(body)) {
      throw new CaseStoreCorruptionError(
        "append_care_case_event returned invalid payload",
      );
    }

    if (body.notFound) {
      throw new CaseNotFoundError(
        input.tenantId,
        input.caseId,
      );
    }

    if (body.conflict) {
      throw new CaseConflictError(
        input.expectedVersion,
        body.currentVersion ?? input.expectedVersion + 1,
      );
    }

    if (
      !body.ok ||
      body.version !== input.expectedVersion + 1
    ) {
      throw new CaseStoreCorruptionError(
        "append_care_case_event returned inconsistent version",
      );
    }

    return next;
  }
}
