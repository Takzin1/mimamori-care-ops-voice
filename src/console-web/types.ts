import type {
  CaseCommandType,
  CasePriority,
  CaseStatus,
  CompletionOutcome,
  EvidenceKind,
} from "../core/types.ts";
import type {
  LiveConsoleWorkspaceSnapshot,
} from "../console/types.ts";

export interface ConsoleWebQueueCard {
  caseId: string;
  subjectId: string;
  priority: CasePriority;
  status: CaseStatus;
  attentionReason: string;
  owner: string | null;
  handoffTarget: string | null;
  hasActiveBreach: boolean;
  overdueMinutes: number;
  nextDeadlineAt: string | null;
  selected: boolean;
}

export interface ConsoleWebAction {
  type: CaseCommandType;
  label: string;
  requires: readonly string[];
}

export interface ConsoleWebModel {
  sessionState:
    LiveConsoleWorkspaceSnapshot["session"]["state"];
  tenantId: string;
  operator: {
    actorId: string;
    roles: readonly string[];
    queueVisibility: string;
  } | null;
  queue: {
    loading: boolean;
    error: string | null;
    total: number;
    breached: number;
    unassigned: number;
    handoffPending: number;
    cards: ConsoleWebQueueCard[];
  };
  selected: {
    caseId: string;
    active: boolean | null;
    status: CaseStatus;
    priority: CasePriority;
    version: number;
    subjectId: string;
    sourceType: string;
    owner: string | null;
    handoffTarget: string | null;
    completionOutcome: string | null;
    evidenceCount: number;
  } | null;
  metrics: {
    ttaMinutes: number | null;
    assignmentMinutes: number | null;
    firstActionMinutes: number | null;
    ttcMinutes: number | null;
    handoffCount: number;
    reopenCount: number;
  } | null;
  actions: ConsoleWebAction[];
  mutationPending: boolean;
  mutationError: string | null;
  staleConflict: {
    expectedVersion: number;
    actualVersion: number | null;
  } | null;
  detailError: string | null;
  capabilityError: string | null;
  lastSuccessfulRefreshAt: string | null;
}

export interface ConsoleCommandFormValues {
  priority?: CasePriority | string;
  assigneeId?: string;
  targetAssigneeId?: string;
  outcome?: CompletionOutcome | string;
  summary?: string;
  evidenceKind?: EvidenceKind | string;
  evidenceRef?: string;
  reason?: string;
}

export interface LiveConsoleWebRendererOptions {
  root: HTMLElement;
  workspace: {
    initialize(): Promise<void>;
    snapshot(): LiveConsoleWorkspaceSnapshot;
    subscribe(
      listener: (
        snapshot: Readonly<LiveConsoleWorkspaceSnapshot>,
      ) => void,
    ): () => void;
    refreshQueue(): Promise<void>;
    refreshSelectedCase(): Promise<void>;
    selectCase(caseId: string): Promise<void>;
    execute(
      command: import("../application/types.ts").CaseCommandIntent,
    ): Promise<void>;
    clearSelection(): void;
    signOut(): Promise<void>;
  };
}

export interface LiveConsoleWebRendererHandle {
  start(): Promise<void>;
  dispose(): void;
}
