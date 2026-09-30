import type {
  LiveConsoleWorkspaceSnapshot,
} from "../console/types.ts";
import type {
  ConsoleWebAction,
  ConsoleWebModel,
} from "./types.ts";

const ACTION_LABELS = {
  set_priority: "優先度を変更",
  acknowledge: "確認済みにする",
  assign: "担当を割り当てる",
  start_action: "対応を開始",
  request_handoff: "引継ぎを依頼",
  accept_handoff: "引継ぎを受諾",
  complete: "支援完了を記録",
  close: "Caseをクローズ",
  reopen: "Caseを再開",
} as const;

function minutes(
  value: number | null,
): number | null {
  if (value === null) return null;
  return Math.round(
    value / 60_000,
  );
}

function errorMessage(
  error: { message: string } | null,
): string | null {
  return error?.message ?? null;
}

export function projectConsoleWebModel(
  snapshot: LiveConsoleWorkspaceSnapshot,
): ConsoleWebModel {
  const queue = snapshot.queue.data;
  const detail = snapshot.detail.data;
  const metrics = snapshot.metrics.data;
  const capabilities =
    snapshot.capabilities.data;
  const operator = snapshot.operator.data;

  const actions: ConsoleWebAction[] =
    capabilities?.commands.map(
      (command) => ({
        type: command.type,
        label:
          ACTION_LABELS[command.type],
        requires: [
          ...command.requires,
        ],
      }),
    ) ?? [];

  return {
    sessionState: snapshot.session.state,
    tenantId: snapshot.tenantId,
    operator: operator
      ? {
          actorId: operator.actorId,
          roles: [...operator.roles],
          queueVisibility:
            operator.queueVisibility,
        }
      : null,
    queue: {
      loading:
        snapshot.queue.state ===
        "loading",
      error: errorMessage(
        snapshot.queue.error,
      ),
      total:
        queue?.summary.total ?? 0,
      breached:
        queue?.summary.breached ?? 0,
      unassigned:
        queue?.summary.unassigned ?? 0,
      handoffPending:
        queue?.summary
          .handoffPending ?? 0,
      cards:
        queue?.items.map((item) => ({
          caseId: item.caseId,
          subjectId: item.subjectId,
          priority: item.priority,
          status: item.status,
          attentionReason:
            item.attentionReason,
          owner: item.assigneeId,
          handoffTarget:
            item.handoffTargetId,
          hasActiveBreach:
            item.hasActiveBreach,
          overdueMinutes:
            minutes(
              item.maxActiveOverdueMs,
            ) ?? 0,
          nextDeadlineAt:
            item.nextDeadlineAt,
          selected:
            item.caseId ===
            snapshot.selectedCaseId,
        })) ?? [],
    },
    selected: detail
      ? {
          caseId: detail.aggregate.id,
          active:
            snapshot.selectedCaseActive,
          status:
            detail.aggregate.status,
          priority:
            detail.aggregate.priority,
          version:
            detail.aggregate.version,
          subjectId:
            detail.aggregate.subjectId,
          sourceType:
            detail.aggregate.sourceType,
          owner:
            detail.aggregate.assigneeId,
          handoffTarget:
            detail.aggregate
              .handoffTargetId,
          completionOutcome:
            detail.aggregate.completion
              ?.outcome ?? null,
          evidenceCount:
            detail.aggregate.completion
              ?.evidence.length ?? 0,
        }
      : null,
    metrics: metrics
      ? {
          ttaMinutes:
            minutes(
              metrics.timeToAcknowledgeMs,
            ),
          assignmentMinutes:
            minutes(
              metrics.timeToAssignmentMs,
            ),
          firstActionMinutes:
            minutes(
              metrics.timeToFirstActionMs,
            ),
          ttcMinutes:
            minutes(
              metrics.timeToCompletionMs,
            ),
          handoffCount:
            metrics.handoffCount,
          reopenCount:
            metrics.reopenCount,
        }
      : null,
    actions,
    mutationPending:
      snapshot.mutation.pending,
    mutationError:
      errorMessage(
        snapshot.mutation.error,
      ),
    staleConflict:
      snapshot.mutation.staleConflict
        ? {
            ...snapshot.mutation
              .staleConflict,
          }
        : null,
    detailError:
      errorMessage(
        snapshot.detail.error,
      ),
    capabilityError:
      errorMessage(
        snapshot.capabilities.error,
      ),
    lastSuccessfulRefreshAt:
      snapshot.lastSuccessfulRefreshAt,
  };
}
