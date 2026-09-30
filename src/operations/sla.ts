import type {
  CaseAggregate,
  CaseEvent,
  CasePriority,
} from "../core/types.ts";

export type SlaStage =
  | "acknowledge"
  | "assign"
  | "first_action"
  | "handoff_accept"
  | "complete";

export interface SlaDurations {
  acknowledgeWithinMs: number;
  assignWithinMs: number;
  firstActionWithinMs: number;
  handoffAcceptWithinMs: number;
  completeWithinMs: number;
}

export type CaseSlaPolicy = Record<CasePriority, SlaDurations>;

export type SlaCheckpointState =
  | "pending"
  | "met"
  | "breached"
  | "not_applicable";

export interface SlaCheckpoint {
  stage: SlaStage;
  startedAt: string | null;
  dueAt: string | null;
  completedAt: string | null;
  state: SlaCheckpointState;
  overdueMs: number;
}

export interface EscalationRecommendation {
  type: "sla_breach";
  tenantId: string;
  caseId: string;
  stage: SlaStage;
  dueAt: string;
  overdueMs: number;
}

export interface CaseSlaEvaluation {
  priority: CasePriority;
  evaluatedAt: string;
  currentStage: SlaStage | null;
  stageAgeMs: number | null;
  nextDeadlineAt: string | null;
  hasActiveBreach: boolean;
  breachedStages: SlaStage[];
  checkpoints: SlaCheckpoint[];
  escalationRecommendations: EscalationRecommendation[];
}

function toMs(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid timestamp for ${label}`);
  }
  return parsed;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function addMs(start: string, durationMs: number): string {
  return iso(toMs(start, "SLA start") + durationMs);
}

function validateDuration(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid SLA duration: ${label}`);
  }
}

export function validateSlaPolicy(policy: CaseSlaPolicy): void {
  for (const priority of [
    "critical",
    "high",
    "normal",
    "low",
  ] as const) {
    const rule = policy[priority];
    validateDuration(
      rule.acknowledgeWithinMs,
      `${priority}.acknowledgeWithinMs`,
    );
    validateDuration(
      rule.assignWithinMs,
      `${priority}.assignWithinMs`,
    );
    validateDuration(
      rule.firstActionWithinMs,
      `${priority}.firstActionWithinMs`,
    );
    validateDuration(
      rule.handoffAcceptWithinMs,
      `${priority}.handoffAcceptWithinMs`,
    );
    validateDuration(
      rule.completeWithinMs,
      `${priority}.completeWithinMs`,
    );
  }
}

function checkpoint(
  stage: SlaStage,
  start: string | null,
  durationMs: number,
  completedAt: string | null,
  nowMs: number,
): SlaCheckpoint {
  if (!start) {
    return {
      stage,
      startedAt: null,
      dueAt: null,
      completedAt,
      state: "not_applicable",
      overdueMs: 0,
    };
  }

  const dueAt = addMs(start, durationMs);
  const dueMs = toMs(dueAt, `${stage} dueAt`);

  if (completedAt) {
    const completedMs = toMs(
      completedAt,
      `${stage} completedAt`,
    );
    return {
      stage,
      startedAt: start,
      dueAt,
      completedAt,
      state: completedMs <= dueMs ? "met" : "breached",
      overdueMs: Math.max(0, completedMs - dueMs),
    };
  }

  return {
    stage,
    startedAt: start,
    dueAt,
    completedAt: null,
    state: nowMs <= dueMs ? "pending" : "breached",
    overdueMs: Math.max(0, nowMs - dueMs),
  };
}

function latestEvent(
  events: readonly CaseEvent[],
  types: readonly CaseEvent["type"][],
): CaseEvent | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event && types.includes(event.type)) {
      return event;
    }
  }
  return null;
}

function latestHandoffCheckpoint(
  events: readonly CaseEvent[],
  durationMs: number,
  nowMs: number,
): SlaCheckpoint {
  const request = latestEvent(events, ["handoff_requested"]);
  if (!request || request.type !== "handoff_requested") {
    return checkpoint(
      "handoff_accept",
      null,
      durationMs,
      null,
      nowMs,
    );
  }

  const acceptance = events.find(
    (event) =>
      event.sequence > request.sequence &&
      event.type === "handoff_accepted",
  );

  return checkpoint(
    "handoff_accept",
    request.at,
    durationMs,
    acceptance?.at ?? null,
    nowMs,
  );
}

function currentStage(
  aggregate: CaseAggregate,
): SlaStage | null {
  switch (aggregate.status) {
    case "NEW":
      return "acknowledge";
    case "ACKNOWLEDGED":
      return "assign";
    case "ASSIGNED":
      return "first_action";
    case "HANDOFF_PENDING":
      return "handoff_accept";
    case "IN_PROGRESS":
      return "complete";
    case "COMPLETED":
    case "CLOSED":
      return null;
  }
}

function currentStageStartedAt(
  aggregate: CaseAggregate,
  events: readonly CaseEvent[],
): string | null {
  switch (aggregate.status) {
    case "NEW":
      return aggregate.createdAt;
    case "ACKNOWLEDGED":
      return aggregate.acknowledgedAt;
    case "ASSIGNED":
      return aggregate.assignedAt;
    case "HANDOFF_PENDING": {
      const request = latestEvent(events, ["handoff_requested"]);
      return request?.at ?? null;
    }
    case "IN_PROGRESS": {
      const operationalStart = latestEvent(events, [
        "action_started",
        "handoff_accepted",
        "reopened",
      ]);
      return operationalStart?.at ?? aggregate.firstActionAt;
    }
    case "COMPLETED":
    case "CLOSED":
      return null;
  }
}

export function evaluateCaseSla(
  aggregate: CaseAggregate,
  events: readonly CaseEvent[],
  policy: CaseSlaPolicy,
  now: string,
): CaseSlaEvaluation {
  validateSlaPolicy(policy);
  const nowMs = toMs(now, "evaluation time");
  const rule = policy[aggregate.priority];

  const checkpoints: SlaCheckpoint[] = [
    checkpoint(
      "acknowledge",
      aggregate.createdAt,
      rule.acknowledgeWithinMs,
      aggregate.acknowledgedAt,
      nowMs,
    ),
    checkpoint(
      "assign",
      aggregate.acknowledgedAt,
      rule.assignWithinMs,
      aggregate.assignedAt,
      nowMs,
    ),
    checkpoint(
      "first_action",
      aggregate.assignedAt,
      rule.firstActionWithinMs,
      aggregate.firstActionAt,
      nowMs,
    ),
    latestHandoffCheckpoint(
      events,
      rule.handoffAcceptWithinMs,
      nowMs,
    ),
    checkpoint(
      "complete",
      aggregate.createdAt,
      rule.completeWithinMs,
      aggregate.completedAt,
      nowMs,
    ),
  ];

  const activeBreaches = checkpoints.filter(
    (item) =>
      item.state === "breached" &&
      item.completedAt === null,
  );

  const openDeadlines = checkpoints
    .filter(
      (item) =>
        item.completedAt === null &&
        item.dueAt !== null &&
        item.state !== "not_applicable",
    )
    .map((item) => item.dueAt!)
    .sort(
      (a, b) =>
        toMs(a, "deadline") - toMs(b, "deadline"),
    );

  const stage = currentStage(aggregate);
  const stageStart = currentStageStartedAt(aggregate, events);

  return {
    priority: aggregate.priority,
    evaluatedAt: now,
    currentStage: stage,
    stageAgeMs: stageStart
      ? Math.max(0, nowMs - toMs(stageStart, "stage start"))
      : null,
    nextDeadlineAt: openDeadlines[0] ?? null,
    hasActiveBreach: activeBreaches.length > 0,
    breachedStages: activeBreaches.map((item) => item.stage),
    checkpoints,
    escalationRecommendations: activeBreaches.map((item) => ({
      type: "sla_breach",
      tenantId: aggregate.tenantId,
      caseId: aggregate.id,
      stage: item.stage,
      dueAt: item.dueAt!,
      overdueMs: item.overdueMs,
    })),
  };
}
