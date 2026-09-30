import {
  calculateCaseMetrics,
  type CaseEvent,
  type CaseMetrics,
  type CasePriority,
  type CaseStatus,
} from "../core/index.ts";
import {
  evaluateCaseSla,
  type CaseQueueProjection,
  type CaseSlaEvaluation,
  type CaseSlaPolicy,
  type QueueAttentionReason,
  type SlaStage,
} from "../operations/index.ts";
import type { StoredCase } from "../persistence/index.ts";

export interface ConsoleSummaryView {
  total: number;
  breached: number;
  unacknowledged: number;
  unassigned: number;
  handoffPending: number;
}

export interface ConsoleQueueCardView {
  caseId: string;
  subjectId: string;
  priority: CasePriority;
  status: CaseStatus;
  attentionReason: QueueAttentionReason;
  currentStage: SlaStage | null;
  assigneeId: string | null;
  handoffTargetId: string | null;
  stageAgeMinutes: number | null;
  nextDeadlineAt: string | null;
  overdueMinutes: number;
}

export interface ConsoleQueueView {
  tenantId: string;
  evaluatedAt: string;
  summary: ConsoleSummaryView;
  cards: ConsoleQueueCardView[];
}

export interface ConsoleTimelineItemView {
  sequence: number;
  type: CaseEvent["type"];
  at: string;
  actorId: string | null;
  title: string;
  detail: string | null;
}

export interface ConsoleCaseDetailView {
  caseId: string;
  tenantId: string;
  subjectId: string;
  priority: CasePriority;
  status: CaseStatus;
  version: number;
  sourceType: string;
  assigneeId: string | null;
  handoffTargetId: string | null;
  createdAt: string;
  completion: StoredCase["aggregate"]["completion"];
  metrics: CaseMetrics;
  sla: CaseSlaEvaluation;
  timeline: ConsoleTimelineItemView[];
}

function minutes(ms: number | null): number | null {
  if (ms === null) return null;
  return Math.floor(ms / 60_000);
}

function eventTitle(event: CaseEvent): string {
  switch (event.type) {
    case "case_created":
      return "Case発生";
    case "priority_changed":
      return "優先度変更";
    case "acknowledged":
      return "確認済み";
    case "assigned":
      return "担当確定";
    case "action_started":
      return "対応開始";
    case "handoff_requested":
      return "引継ぎ依頼";
    case "handoff_accepted":
      return "引継ぎ受諾";
    case "completed":
      return "支援完了";
    case "closed":
      return "Caseクローズ";
    case "reopened":
      return "Case再開";
  }
}

function eventDetail(event: CaseEvent): string | null {
  switch (event.type) {
    case "case_created":
      return `${event.data.sourceType} / ${event.data.priority}`;
    case "priority_changed":
      return `${event.data.previousPriority} → ${event.data.priority}`;
    case "assigned":
      return `担当: ${event.data.assigneeId}`;
    case "handoff_requested":
      return `引継ぎ先: ${event.data.targetAssigneeId}`;
    case "handoff_accepted":
      return `前担当: ${event.data.previousAssigneeId}`;
    case "completed":
      return `${event.data.outcome} / 証跡 ${event.data.evidence.length}件`;
    case "reopened":
      return event.data.reason;
    case "acknowledged":
    case "action_started":
    case "closed":
      return null;
  }
}

export function presentCaseQueue(
  projection: CaseQueueProjection,
): ConsoleQueueView {
  return {
    tenantId: projection.tenantId,
    evaluatedAt: projection.evaluatedAt,
    summary: {
      total: projection.summary.total,
      breached: projection.summary.breached,
      unacknowledged: projection.summary.unacknowledged,
      unassigned: projection.summary.unassigned,
      handoffPending: projection.summary.handoffPending,
    },
    cards: projection.items.map((item) => ({
      caseId: item.caseId,
      subjectId: item.subjectId,
      priority: item.priority,
      status: item.status,
      attentionReason: item.attentionReason,
      currentStage: item.currentStage,
      assigneeId: item.assigneeId,
      handoffTargetId: item.handoffTargetId,
      stageAgeMinutes: minutes(item.stageAgeMs),
      nextDeadlineAt: item.nextDeadlineAt,
      overdueMinutes: minutes(item.maxActiveOverdueMs) ?? 0,
    })),
  };
}

export function presentCaseDetail(
  stored: StoredCase,
  policy: CaseSlaPolicy,
  now: string,
): ConsoleCaseDetailView {
  return {
    caseId: stored.aggregate.id,
    tenantId: stored.aggregate.tenantId,
    subjectId: stored.aggregate.subjectId,
    priority: stored.aggregate.priority,
    status: stored.aggregate.status,
    version: stored.aggregate.version,
    sourceType: stored.aggregate.sourceType,
    assigneeId: stored.aggregate.assigneeId,
    handoffTargetId: stored.aggregate.handoffTargetId,
    createdAt: stored.aggregate.createdAt,
    completion: structuredClone(stored.aggregate.completion),
    metrics: calculateCaseMetrics(stored.events),
    sla: evaluateCaseSla(
      stored.aggregate,
      stored.events,
      policy,
      now,
    ),
    timeline: stored.events.map((event) => ({
      sequence: event.sequence,
      type: event.type,
      at: event.at,
      actorId: event.actorId,
      title: eventTitle(event),
      detail: eventDetail(event),
    })),
  };
}
