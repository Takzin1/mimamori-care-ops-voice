import type {
  CaseCapabilitiesProjection,
  OperatorContextProjection,
} from "../application/capabilities.ts";
import type {
  CaseCommandIntent,
  CaseOperationResult,
} from "../application/types.ts";
import {
  CareOpsHttpClient,
} from "../client/care-ops-http-client.ts";
import {
  CareOpsHttpClientError,
} from "../client/errors.ts";
import type {
  CareOpsClient,
} from "../client/types.ts";
import type {
  CaseMetrics,
} from "../core/metrics.ts";
import type {
  CaseQueueProjection,
} from "../operations/queue.ts";
import type {
  StoredCase,
} from "../persistence/types.ts";
import {
  CareOpsSessionDisposedError,
  CareOpsSessionUnavailableError,
} from "./errors.ts";
import type {
  BrowserAuthSessionProvider,
  BrowserAuthSessionStatus,
  CareOpsSessionClient,
  CareOpsSessionControllerOptions,
  CareOpsSessionListener,
  CareOpsSessionSnapshot,
} from "./types.ts";

function safeExpiresAt(
  value: string | null | undefined,
): string | null {
  if (
    typeof value !== "string" ||
    !value.trim()
  ) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed)
    ? new Date(parsed).toISOString()
    : null;
}

function cloneSnapshot(
  value: CareOpsSessionSnapshot,
): CareOpsSessionSnapshot {
  return {
    state: value.state,
    expiresAt: value.expiresAt,
    generation: value.generation,
  };
}

export class CareOpsSessionController
implements CareOpsSessionClient {
  readonly #provider: BrowserAuthSessionProvider;
  readonly #client: CareOpsClient;
  readonly #listeners =
    new Set<CareOpsSessionListener>();
  readonly #unsubscribeProvider: () => void;

  #snapshot: CareOpsSessionSnapshot = {
    state: "signed_out",
    expiresAt: null,
    generation: 0,
  };

  #disposed = false;

  constructor(
    options: CareOpsSessionControllerOptions,
  ) {
    this.#provider = options.provider;

    this.#client = new CareOpsHttpClient({
      baseUrl: options.baseUrl,
      accessTokenProvider: async () =>
        await this.#accessToken(),
      fetchImpl: options.fetchImpl,
    });

    this.#unsubscribeProvider =
      this.#provider.subscribe(
        (status) => {
          if (this.#disposed) return;
          this.#applyProviderStatus(status);
        },
      );
  }

  #assertActive(): void {
    if (this.#disposed) {
      throw new CareOpsSessionDisposedError();
    }
  }

  #emit(
    next: CareOpsSessionSnapshot,
  ): void {
    this.#snapshot = next;
    const snapshot = cloneSnapshot(next);

    for (const listener of this.#listeners) {
      try {
        listener(snapshot);
      } catch {
        // UI listeners must not break session state.
      }
    }
  }

  #transition(
    state: CareOpsSessionSnapshot["state"],
    expiresAt: string | null,
  ): void {
    if (
      this.#snapshot.state === state &&
      this.#snapshot.expiresAt === expiresAt
    ) {
      return;
    }

    this.#emit({
      state,
      expiresAt,
      generation:
        this.#snapshot.generation + 1,
    });
  }

  #applyProviderStatus(
    status: BrowserAuthSessionStatus,
  ): void {
    if (status.status === "signed_out") {
      this.#transition(
        "signed_out",
        null,
      );
      return;
    }

    this.#transition(
      "ready",
      safeExpiresAt(status.expiresAt),
    );
  }

  #requireReauthentication(): void {
    this.#transition(
      "reauthentication_required",
      null,
    );
  }

  async #accessToken(): Promise<string> {
    this.#assertActive();

    if (this.#snapshot.state !== "ready") {
      throw new CareOpsSessionUnavailableError();
    }

    const token =
      await this.#provider.accessToken();

    if (
      typeof token !== "string" ||
      !token
    ) {
      this.#requireReauthentication();
      throw new CareOpsSessionUnavailableError();
    }

    return token;
  }

  async #run<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
    this.#assertActive();

    if (this.#snapshot.state !== "ready") {
      throw new CareOpsSessionUnavailableError();
    }

    try {
      return await operation();
    } catch (error) {
      if (
        error instanceof CareOpsHttpClientError &&
        error.status === 401
      ) {
        this.#requireReauthentication();
      }

      throw error;
    }
  }

  async initialize():
  Promise<CareOpsSessionSnapshot> {
    this.#assertActive();

    const status =
      await this.#provider.currentStatus();

    this.#applyProviderStatus(status);

    return this.snapshot();
  }

  snapshot(): CareOpsSessionSnapshot {
    this.#assertActive();
    return cloneSnapshot(this.#snapshot);
  }

  subscribe(
    listener: CareOpsSessionListener,
  ): () => void {
    this.#assertActive();
    this.#listeners.add(listener);

    return () => {
      this.#listeners.delete(listener);
    };
  }

  async signOut(): Promise<void> {
    this.#assertActive();

    await this.#provider.signOut();
    this.#transition(
      "signed_out",
      null,
    );
  }

  dispose(): void {
    if (this.#disposed) return;

    this.#disposed = true;
    this.#unsubscribeProvider();
    this.#listeners.clear();
  }

  operatorContext(
    tenantId: string,
  ): Promise<OperatorContextProjection> {
    return this.#run(
      () =>
        this.#client.operatorContext(
          tenantId,
        ),
    );
  }

  caseCapabilities(
    tenantId: string,
    caseId: string,
  ): Promise<CaseCapabilitiesProjection> {
    return this.#run(
      () =>
        this.#client.caseCapabilities(
          tenantId,
          caseId,
        ),
    );
  }

  queue(
    tenantId: string,
  ): Promise<CaseQueueProjection> {
    return this.#run(
      () => this.#client.queue(tenantId),
    );
  }

  getCase(
    tenantId: string,
    caseId: string,
  ): Promise<StoredCase> {
    return this.#run(
      () =>
        this.#client.getCase(
          tenantId,
          caseId,
        ),
    );
  }

  metrics(
    tenantId: string,
    caseId: string,
  ): Promise<CaseMetrics> {
    return this.#run(
      () =>
        this.#client.metrics(
          tenantId,
          caseId,
        ),
    );
  }

  execute(
    tenantId: string,
    caseId: string,
    expectedVersion: number,
    command: CaseCommandIntent,
  ): Promise<CaseOperationResult> {
    return this.#run(
      () =>
        this.#client.execute(
          tenantId,
          caseId,
          expectedVersion,
          command,
        ),
    );
  }
}
