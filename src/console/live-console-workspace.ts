import type {
  CaseCommandIntent,
} from "../application/types.ts";
import {
  CareOpsHttpClientError,
  CareOpsHttpProtocolError,
} from "../client/errors.ts";
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
  CareOpsSessionUnavailableError,
} from "../session/errors.ts";
import type {
  CareOpsSessionClient,
  CareOpsSessionSnapshot,
} from "../session/types.ts";
import {
  LiveConsoleMutationPendingError,
  LiveConsoleSelectionRequiredError,
  LiveConsoleWorkspaceDisposedError,
} from "./errors.ts";
import type {
  ConsoleWorkspaceError,
  LiveConsoleWorkspaceClient,
  LiveConsoleWorkspaceListener,
  LiveConsoleWorkspaceOptions,
  LiveConsoleWorkspaceSnapshot,
  WorkspaceResource,
} from "./types.ts";

function emptyResource<T>():
WorkspaceResource<T> {
  return {
    state: "idle",
    data: null,
    error: null,
  };
}

function cloneError(
  error: ConsoleWorkspaceError | null,
): ConsoleWorkspaceError | null {
  if (!error) return null;

  return {
    status: error.status,
    code: error.code,
    message: error.message,
    requestId: error.requestId,
    details: error.details
      ? structuredClone(error.details)
      : null,
  };
}

function cloneResource<T>(
  resource: WorkspaceResource<T>,
): WorkspaceResource<T> {
  return {
    state: resource.state,
    data: resource.data
      ? structuredClone(resource.data)
      : null,
    error: cloneError(resource.error),
  };
}

function cloneSnapshot(
  value: LiveConsoleWorkspaceSnapshot,
): LiveConsoleWorkspaceSnapshot {
  return {
    tenantId: value.tenantId,
    session: {
      state: value.session.state,
      expiresAt: value.session.expiresAt,
      generation: value.session.generation,
    },
    operator: cloneResource(
      value.operator,
    ),
    queue: cloneResource(value.queue),
    selectedCaseId: value.selectedCaseId,
    selectedCaseActive:
      value.selectedCaseActive,
    detail: cloneResource(value.detail),
    metrics: cloneResource(value.metrics),
    capabilities: cloneResource(
      value.capabilities,
    ),
    mutation: {
      pending: value.mutation.pending,
      error: cloneError(
        value.mutation.error,
      ),
      staleConflict:
        value.mutation.staleConflict
          ? {
              expectedVersion:
                value.mutation
                  .staleConflict
                  .expectedVersion,
              actualVersion:
                value.mutation
                  .staleConflict
                  .actualVersion,
            }
          : null,
    },
    lastSuccessfulRefreshAt:
      value.lastSuccessfulRefreshAt,
    generation: value.generation,
  };
}

function workspaceError(
  error: unknown,
): ConsoleWorkspaceError {
  if (error instanceof CareOpsHttpClientError) {
    return {
      status: error.status,
      code: error.code,
      message: error.message,
      requestId: error.requestId,
      details: error.details
        ? structuredClone(error.details)
        : null,
    };
  }

  if (
    error instanceof
      CareOpsSessionUnavailableError
  ) {
    return {
      status: 401,
      code: error.code,
      message: "Authentication required",
      requestId: null,
      details: null,
    };
  }

  if (
    error instanceof
      CareOpsHttpProtocolError
  ) {
    return {
      status: null,
      code: error.code,
      message:
        "Care Operations service returned an invalid response",
      requestId: null,
      details: null,
    };
  }

  return {
    status: null,
    code: "LIVE_CONSOLE_OPERATION_FAILED",
    message:
      "Unable to complete the Care Operations request",
    requestId: null,
    details: null,
  };
}

function numericDetail(
  details: Readonly<Record<string, unknown>> | null,
  key: string,
): number | null {
  const value = details?.[key];
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1
  )
    ? value
    : null;
}

function caseIsActive(
  queue: CaseQueueProjection | null,
  caseId: string | null,
): boolean | null {
  if (!caseId || !queue) return null;

  return queue.items.some(
    (item) => item.caseId === caseId,
  );
}

export class LiveConsoleWorkspace
implements LiveConsoleWorkspaceClient {
  readonly #tenantId: string;
  readonly #session: CareOpsSessionClient;
  readonly #now: () => string;
  readonly #listeners =
    new Set<LiveConsoleWorkspaceListener>();
  readonly #unsubscribeSession: () => void;

  #snapshot: LiveConsoleWorkspaceSnapshot;
  #disposed = false;
  #operatorRequest = 0;
  #queueRequest = 0;
  #selectionRequest = 0;
  #mutationRequest = 0;

  constructor(
    options: LiveConsoleWorkspaceOptions,
  ) {
    this.#tenantId = options.tenantId;
    this.#session = options.session;
    this.#now =
      options.now ??
      (() => new Date().toISOString());

    const session =
      this.#session.snapshot();

    this.#snapshot = {
      tenantId: this.#tenantId,
      session,
      operator: emptyResource(),
      queue: emptyResource(),
      selectedCaseId: null,
      selectedCaseActive: null,
      detail: emptyResource(),
      metrics: emptyResource(),
      capabilities: emptyResource(),
      mutation: {
        pending: false,
        error: null,
        staleConflict: null,
      },
      lastSuccessfulRefreshAt: null,
      generation: 0,
    };

    this.#unsubscribeSession =
      this.#session.subscribe(
        (next) => {
          if (this.#disposed) return;
          this.#onSession(next);
        },
      );
  }

  #assertActive(): void {
    if (this.#disposed) {
      throw new LiveConsoleWorkspaceDisposedError();
    }
  }

  #emit(
    update: (
      current:
        LiveConsoleWorkspaceSnapshot,
    ) => LiveConsoleWorkspaceSnapshot,
  ): void {
    const next = update(this.#snapshot);

    this.#snapshot = {
      ...next,
      generation:
        this.#snapshot.generation + 1,
    };

    const snapshot =
      cloneSnapshot(this.#snapshot);

    for (const listener of this.#listeners) {
      try {
        listener(snapshot);
      } catch {
        // Renderer listeners cannot break
        // operational workspace state.
      }
    }
  }

  #onSession(
    session: CareOpsSessionSnapshot,
  ): void {
    if (session.state !== "ready") {
      this.#operatorRequest += 1;
      this.#queueRequest += 1;
      this.#selectionRequest += 1;
      this.#mutationRequest += 1;

      this.#emit((current) => ({
        ...current,
        session: {
          ...session,
        },
        operator: emptyResource(),
        queue: emptyResource(),
        selectedCaseId: null,
        selectedCaseActive: null,
        detail: emptyResource(),
        metrics: emptyResource(),
        capabilities: emptyResource(),
        mutation: {
          pending: false,
          error: null,
          staleConflict: null,
        },
        lastSuccessfulRefreshAt: null,
      }));
      return;
    }

    this.#emit((current) => ({
      ...current,
      session: {
        ...session,
      },
    }));
  }

  #ready(): boolean {
    return (
      this.#snapshot.session.state ===
      "ready"
    );
  }

  #selected(
    caseId: string,
    request: number,
  ): boolean {
    return (
      !this.#disposed &&
      this.#ready() &&
      this.#selectionRequest === request &&
      this.#snapshot.selectedCaseId ===
        caseId
    );
  }

  async #loadSelected(
    caseId: string,
    request: number,
  ): Promise<void> {
    const [
      detail,
      metrics,
      capabilities,
    ] = await Promise.allSettled([
      this.#session.getCase(
        this.#tenantId,
        caseId,
      ),
      this.#session.metrics(
        this.#tenantId,
        caseId,
      ),
      this.#session.caseCapabilities(
        this.#tenantId,
        caseId,
      ),
    ]);

    if (!this.#selected(caseId, request)) {
      return;
    }

    const detailError =
      detail.status === "rejected"
        ? workspaceError(detail.reason)
        : null;
    const metricsError =
      metrics.status === "rejected"
        ? workspaceError(metrics.reason)
        : null;
    const capabilityError =
      capabilities.status === "rejected"
        ? workspaceError(
            capabilities.reason,
          )
        : null;

    this.#emit((current) => ({
      ...current,
      detail:
        detail.status === "fulfilled"
          ? {
              state: "ready",
              data: detail.value,
              error: null,
            }
          : {
              state: "error",
              data: current.detail.data,
              error: detailError,
            },
      metrics:
        metrics.status === "fulfilled"
          ? {
              state: "ready",
              data: metrics.value,
              error: null,
            }
          : {
              state: "error",
              data: current.metrics.data,
              error: metricsError,
            },
      capabilities:
        capabilities.status === "fulfilled"
          ? {
              state: "ready",
              data: capabilities.value,
              error: null,
            }
          : {
              state: "error",
              data:
                current.capabilities.data,
              error: capabilityError,
            },
      lastSuccessfulRefreshAt:
        detail.status === "fulfilled" ||
        metrics.status === "fulfilled" ||
        capabilities.status === "fulfilled"
          ? this.#now()
          : current.lastSuccessfulRefreshAt,
    }));
  }

  async initialize(): Promise<void> {
    this.#assertActive();

    const session =
      await this.#session.initialize();

    if (
      this.#snapshot.session.generation !==
        session.generation ||
      this.#snapshot.session.state !==
        session.state ||
      this.#snapshot.session.expiresAt !==
        session.expiresAt
    ) {
      this.#onSession(session);
    }

    if (session.state === "ready") {
      await Promise.all([
        this.refreshOperator(),
        this.refreshQueue(),
      ]);
    }
  }

  snapshot():
  LiveConsoleWorkspaceSnapshot {
    this.#assertActive();
    return cloneSnapshot(this.#snapshot);
  }

  subscribe(
    listener: LiveConsoleWorkspaceListener,
  ): () => void {
    this.#assertActive();
    this.#listeners.add(listener);

    return () => {
      this.#listeners.delete(listener);
    };
  }

  async signOut(): Promise<void> {
    this.#assertActive();
    await this.#session.signOut();
  }

  async refreshOperator(): Promise<void> {
    this.#assertActive();
    if (!this.#ready()) return;

    const request =
      ++this.#operatorRequest;

    this.#emit((current) => ({
      ...current,
      operator: {
        state: "loading",
        data: current.operator.data,
        error: null,
      },
    }));

    try {
      const operator =
        await this.#session.operatorContext(
          this.#tenantId,
        );

      if (
        this.#disposed ||
        !this.#ready() ||
        request !== this.#operatorRequest
      ) {
        return;
      }

      this.#emit((current) => ({
        ...current,
        operator: {
          state: "ready",
          data: operator,
          error: null,
        },
        lastSuccessfulRefreshAt:
          this.#now(),
      }));
    } catch (error) {
      if (
        this.#disposed ||
        !this.#ready() ||
        request !== this.#operatorRequest
      ) {
        return;
      }

      this.#emit((current) => ({
        ...current,
        operator: {
          state: "error",
          data: current.operator.data,
          error: workspaceError(error),
        },
      }));
    }
  }

  async refreshQueue(): Promise<void> {
    this.#assertActive();
    if (!this.#ready()) return;

    const request = ++this.#queueRequest;

    this.#emit((current) => ({
      ...current,
      queue: {
        state: "loading",
        data: current.queue.data,
        error: null,
      },
    }));

    try {
      const queue =
        await this.#session.queue(
          this.#tenantId,
        );

      if (
        this.#disposed ||
        !this.#ready() ||
        request !== this.#queueRequest
      ) {
        return;
      }

      this.#emit((current) => ({
        ...current,
        queue: {
          state: "ready",
          data: queue,
          error: null,
        },
        selectedCaseActive:
          caseIsActive(
            queue,
            current.selectedCaseId,
          ),
        lastSuccessfulRefreshAt:
          this.#now(),
      }));
    } catch (error) {
      if (
        this.#disposed ||
        !this.#ready() ||
        request !== this.#queueRequest
      ) {
        return;
      }

      this.#emit((current) => ({
        ...current,
        queue: {
          state: "error",
          data: current.queue.data,
          error: workspaceError(error),
        },
      }));
    }
  }

  async selectCase(
    caseId: string,
  ): Promise<void> {
    this.#assertActive();
    if (!this.#ready()) return;

    const request =
      ++this.#selectionRequest;

    this.#emit((current) => ({
      ...current,
      selectedCaseId: caseId,
      selectedCaseActive:
        caseIsActive(
          current.queue.data,
          caseId,
        ),
      detail: {
        state: "loading",
        data: null,
        error: null,
      },
      metrics: {
        state: "loading",
        data: null,
        error: null,
      },
      capabilities: {
        state: "loading",
        data: null,
        error: null,
      },
      mutation: {
        pending: false,
        error: null,
        staleConflict: null,
      },
    }));

    await this.#loadSelected(
      caseId,
      request,
    );
  }

  async refreshSelectedCase():
  Promise<void> {
    this.#assertActive();

    const caseId =
      this.#snapshot.selectedCaseId;

    if (!caseId) {
      throw new LiveConsoleSelectionRequiredError();
    }

    if (!this.#ready()) return;

    const request =
      ++this.#selectionRequest;

    this.#emit((current) => ({
      ...current,
      detail: {
        state: "loading",
        data: current.detail.data,
        error: null,
      },
      metrics: {
        state: "loading",
        data: current.metrics.data,
        error: null,
      },
      capabilities: {
        state: "loading",
        data:
          current.capabilities.data,
        error: null,
      },
    }));

    await this.#loadSelected(
      caseId,
      request,
    );
  }

  async execute(
    command: CaseCommandIntent,
  ): Promise<void> {
    this.#assertActive();

    const caseId =
      this.#snapshot.selectedCaseId;
    const stored =
      this.#snapshot.detail.data;

    if (!caseId || !stored) {
      throw new LiveConsoleSelectionRequiredError();
    }

    if (this.#snapshot.mutation.pending) {
      throw new LiveConsoleMutationPendingError();
    }

    if (!this.#ready()) return;

    const expectedVersion =
      stored.aggregate.version;
    const request =
      ++this.#mutationRequest;

    this.#emit((current) => ({
      ...current,
      mutation: {
        pending: true,
        error: null,
        staleConflict: null,
      },
    }));

    try {
      const result =
        await this.#session.execute(
          this.#tenantId,
          caseId,
          expectedVersion,
          command,
        );

      if (
        this.#disposed ||
        !this.#ready() ||
        request !==
          this.#mutationRequest
      ) {
        return;
      }

      if (
        this.#snapshot.selectedCaseId ===
          caseId
      ) {
        this.#emit((current) => ({
          ...current,
          detail: {
            state: "ready",
            data: current.detail.data
              ? {
                  aggregate:
                    result.aggregate,
                  events: [
                    ...current.detail.data
                      .events,
                    result.event,
                  ],
                }
              : null,
            error: null,
          },
          mutation: {
            pending: false,
            error: null,
            staleConflict: null,
          },
        }));
      } else {
        this.#emit((current) => ({
          ...current,
          mutation: {
            pending: false,
            error: null,
            staleConflict: null,
          },
        }));
      }

      await Promise.all([
        this.refreshQueue(),
        this.#snapshot.selectedCaseId ===
          caseId
          ? this.refreshSelectedCase()
          : Promise.resolve(),
      ]);
    } catch (error) {
      if (
        this.#disposed ||
        request !==
          this.#mutationRequest
      ) {
        return;
      }

      if (!this.#ready()) {
        return;
      }

      const mapped =
        workspaceError(error);

      if (
        error instanceof
          CareOpsHttpClientError &&
        error.status === 409
      ) {
        const expected =
          numericDetail(
            error.details,
            "expectedVersion",
          ) ??
          expectedVersion;
        const actual =
          numericDetail(
            error.details,
            "actualVersion",
          );

        this.#emit((current) => ({
          ...current,
          mutation: {
            pending: false,
            error: mapped,
            staleConflict: {
              expectedVersion:
                expected,
              actualVersion:
                actual,
            },
          },
        }));

        await Promise.all([
          this.refreshQueue(),
          this.#snapshot.selectedCaseId ===
            caseId
            ? this.refreshSelectedCase()
            : Promise.resolve(),
        ]);

        return;
      }

      this.#emit((current) => ({
        ...current,
        mutation: {
          pending: false,
          error: mapped,
          staleConflict: null,
        },
      }));
    }
  }

  clearSelection(): void {
    this.#assertActive();

    this.#selectionRequest += 1;
    this.#mutationRequest += 1;

    this.#emit((current) => ({
      ...current,
      selectedCaseId: null,
      selectedCaseActive: null,
      detail: emptyResource(),
      metrics: emptyResource(),
      capabilities: emptyResource(),
      mutation: {
        pending: false,
        error: null,
        staleConflict: null,
      },
    }));
  }

  dispose(): void {
    if (this.#disposed) return;

    this.#disposed = true;
    this.#operatorRequest += 1;
    this.#queueRequest += 1;
    this.#selectionRequest += 1;
    this.#mutationRequest += 1;
    this.#unsubscribeSession();
    this.#listeners.clear();
  }
}
