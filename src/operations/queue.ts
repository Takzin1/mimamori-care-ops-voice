import type {
  CasePriority,
  CaseStatus,
} from "../core/types.ts";
import type { StoredCase } from "../persistence/types.ts";
import {
  evaluateCaseSla,
  type CaseSlaPolicy,
  type SlaStage,
} from "./sla.ts";

export type QueueAttentionReason =
  | "sla_breach"
  | "unacknowledged"
  | "unassigned"
  | "handoff_pending"
  | "active";

export type CaseQueueScope =
  | { type: "tenant" }
  | { type: "responder"; actorId: string };

export interface CaseQueueItem {
  tenantId: string;
  caseId: string;
  subjectId: string;
  priority: CasePriority;
  status: CaseStatus;
  assigneeId: string | null;
  handoffTargetId: string | null;
  createdAt: string;
  currentStage: SlaStage | null;
  stageAgeMs: number | null;
  nextDeadlineAt: string | null;
  hasActiveBreach: boolean;
  maxActiveOverdueMs: number;
  breachedStages: SlaStage[];
  attentionReason: QueueAttentionReason;
}

export interface CaseQueueSummary {
  total: number;
  breached: number;
  unacknowledged: number;
  unassigned: number;
  handoffPending: number;
  byPriority: Record<CasePriority, number>;
}

export interface CaseQueueProjection {
  tenantId: string;
  evaluatedAt: string;
  items: CaseQueueItem[];
  summary: CaseQueueSummary;
}

const PRIORITY_ORDER: Record<CasePriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

function attentionReason(
  status: CaseStatus,
  hasActiveBreach: boolean,
): QueueAttentionReason {
  if (hasActiveBreach) return "sla_breach";
  if (status === "NEW") return "unacknowledged";
  if (status === "ACKNOWLEDGED") return "unassigned";
  if (status === "HANDOFF_PENDING") return "handoff_pending";
  return "active";
}

function deadlineMs(value: string | null): number {
  if (!value) return Number.POSITIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed)
    ? parsed
    : Number.POSITIVE_INFINITY;
}

function createdMs(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed)
    ? parsed
    : Number.POSITIVE_INFINITY;
}

export function compareCaseQueueItems(
  a: CaseQueueItem,
  b: CaseQueueItem,
): number {
  if (a.hasActiveBreach !== b.hasActiveBreach) {
    return a.hasActiveBreach ? -1 : 1;
  }

  const priorityDifference =
    PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
  if (priorityDifference !== 0) return priorityDifference;

  if (
    a.hasActiveBreach &&
    b.hasActiveBreach &&
    a.maxActiveOverdueMs !== b.maxActiveOverdueMs
  ) {
    return b.maxActiveOverdueMs - a.maxActiveOverdueMs;
  }

  const deadlineDifference =
    deadlineMs(a.nextDeadlineAt) - deadlineMs(b.nextDeadlineAt);
  if (deadlineDifference !== 0) return deadlineDifference;

  const ageDifference =
    createdMs(a.createdAt) - createdMs(b.createdAt);
  if (ageDifference !== 0) return ageDifference;

  return a.caseId.localeCompare(b.caseId);
}

function visibleInScope(
  stored: StoredCase,
  scope: CaseQueueScope,
): boolean {
  if (scope.type === "tenant") return true;

  return (
    stored.aggregate.assigneeId === scope.actorId ||
    stored.aggregate.handoffTargetId === scope.actorId
  );
}

export function projectCaseQueue(
  storedCases: readonly StoredCase[],
  tenantId: string,
  scope: CaseQueueScope,
  policy: CaseSlaPolicy,
  now: string,
): CaseQueueProjection {
  const items = storedCases
    .filter((stored) => stored.aggregate.tenantId === tenantId)
    .filter(
      (stored) =>
        stored.aggregate.status !== "COMPLETED" &&
        stored.aggregate.status !== "CLOSED",
    )
    .filter((stored) => visibleInScope(stored, scope))
    .map((stored): CaseQueueItem => {
      const sla = evaluateCaseSla(
        stored.aggregate,
        stored.events,
        policy,
        now,
      );
      const maxActiveOverdueMs = sla.escalationRecommendations.reduce(
        (maximum, item) => Math.max(maximum, item.overdueMs),
        0,
      );

      return {
        tenantId: stored.aggregate.tenantId,
        caseId: stored.aggregate.id,
        subjectId: stored.aggregate.subjectId,
        priority: stored.aggregate.priority,
        status: stored.aggregate.status,
        assigneeId: stored.aggregate.assigneeId,
        handoffTargetId: stored.aggregate.handoffTargetId,
        createdAt: stored.aggregate.createdAt,
        currentStage: sla.currentStage,
        stageAgeMs: sla.stageAgeMs,
        nextDeadlineAt: sla.nextDeadlineAt,
        hasActiveBreach: sla.hasActiveBreach,
        maxActiveOverdueMs,
        breachedStages: [...sla.breachedStages],
        attentionReason: attentionReason(
          stored.aggregate.status,
          sla.hasActiveBreach,
        ),
      };
    })
    .sort(compareCaseQueueItems);

  const summary: CaseQueueSummary = {
    total: items.length,
    breached: items.filter((item) => item.hasActiveBreach).length,
    unacknowledged: items.filter(
      (item) => item.status === "NEW",
    ).length,
    unassigned: items.filter(
      (item) => item.status === "ACKNOWLEDGED",
    ).length,
    handoffPending: items.filter(
      (item) => item.status === "HANDOFF_PENDING",
    ).length,
    byPriority: {
      critical: 0,
      high: 0,
      normal: 0,
      low: 0,
    },
  };

  for (const item of items) {
    summary.byPriority[item.priority] += 1;
  }

  return {
    tenantId,
    evaluatedAt: now,
    items,
    summary,
  };
}
