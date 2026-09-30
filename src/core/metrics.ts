import type { CaseEvent } from "./types.ts";

export interface CaseMetrics {
  timeToAcknowledgeMs: number | null;
  timeToAssignmentMs: number | null;
  timeToFirstActionMs: number | null;
  timeToCompletionMs: number | null;
  handoffCount: number;
  reopenCount: number;
}

function elapsedMs(
  start: string | undefined,
  end: string | undefined,
): number | null {
  if (!start || !end) return null;
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return null;
  }
  return Math.max(0, endMs - startMs);
}

export function calculateCaseMetrics(
  events: readonly CaseEvent[],
): CaseMetrics {
  const created = events.find((event) => event.type === "case_created");
  const acknowledged = events.find(
    (event) => event.type === "acknowledged",
  );
  const assigned = events.find((event) => event.type === "assigned");
  const firstAction = events.find(
    (event) => event.type === "action_started",
  );
  const completedEvents = events.filter(
    (event) => event.type === "completed",
  );
  const lastCompleted = completedEvents.at(-1);

  return {
    timeToAcknowledgeMs: elapsedMs(created?.at, acknowledged?.at),
    timeToAssignmentMs: elapsedMs(created?.at, assigned?.at),
    timeToFirstActionMs: elapsedMs(created?.at, firstAction?.at),
    timeToCompletionMs: elapsedMs(created?.at, lastCompleted?.at),
    handoffCount: events.filter(
      (event) => event.type === "handoff_accepted",
    ).length,
    reopenCount: events.filter(
      (event) => event.type === "reopened",
    ).length,
  };
}
