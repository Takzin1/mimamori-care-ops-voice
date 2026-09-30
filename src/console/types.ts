import type {
  CaseCapabilitiesProjection,
  OperatorContextProjection,
} from "../application/capabilities.ts";
import type {
  CaseCommandIntent,
} from "../application/types.ts";
import type {
  CaseMetrics,
} from "../core/metrics.ts";
import type {
  CaseQueueProjection,
} from "../operations/queue.ts";
import type {
  StoredCase,
} from "../persistence/types.ts";
import type {
  CareOpsSessionClient,
  CareOpsSessionSnapshot,
} from "../session/types.ts";

export type WorkspaceLoadState =
  | "idle"
  | "loading"
  | "ready"
  | "error";

export interface ConsoleWorkspaceError {
  status: number | null;
  code: string;
  message: string;
  requestId: string | null;
  details: Readonly<Record<string, unknown>> | null;
}

export interface WorkspaceResource<T> {
  state: WorkspaceLoadState;
  data: T | null;
  error: ConsoleWorkspaceError | null;
}

export interface WorkspaceMutationState {
  pending: boolean;
  error: ConsoleWorkspaceError | null;
  staleConflict: {
    expectedVersion: number;
    actualVersion: number | null;
  } | null;
}

export interface LiveConsoleWorkspaceSnapshot {
  tenantId: string;
  session: CareOpsSessionSnapshot;
  operator: WorkspaceResource<OperatorContextProjection>;
  queue: WorkspaceResource<CaseQueueProjection>;
  selectedCaseId: string | null;
  selectedCaseActive: boolean | null;
  detail: WorkspaceResource<StoredCase>;
  metrics: WorkspaceResource<CaseMetrics>;
  capabilities: WorkspaceResource<CaseCapabilitiesProjection>;
  mutation: WorkspaceMutationState;
  lastSuccessfulRefreshAt: string | null;
  generation: number;
}

export type LiveConsoleWorkspaceListener = (
  snapshot: Readonly<LiveConsoleWorkspaceSnapshot>,
) => void;

export interface LiveConsoleWorkspaceOptions {
  tenantId: string;
  session: CareOpsSessionClient;
  now?: () => string;
}

export interface LiveConsoleWorkspaceClient {
  initialize(): Promise<void>;

  snapshot(): LiveConsoleWorkspaceSnapshot;

  subscribe(
    listener: LiveConsoleWorkspaceListener,
  ): () => void;

  signOut(): Promise<void>;

  refreshOperator(): Promise<void>;

  refreshQueue(): Promise<void>;

  selectCase(
    caseId: string,
  ): Promise<void>;

  refreshSelectedCase(): Promise<void>;

  execute(
    command: CaseCommandIntent,
  ): Promise<void>;

  clearSelection(): void;

  dispose(): void;
}
