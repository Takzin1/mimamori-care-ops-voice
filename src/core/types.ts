export interface SourceTranscriptEvidence {
  provider: "assemblyai";
  transcriptId: string;
  text: string;
  language: string;
  capturedAt: string;
  provenance: "client_relayed_session_bound";
}

export const CASE_STATUSES = [
  "NEW",
  "ACKNOWLEDGED",
  "ASSIGNED",
  "IN_PROGRESS",
  "HANDOFF_PENDING",
  "COMPLETED",
  "CLOSED",
] as const;

export type CaseStatus = (typeof CASE_STATUSES)[number];

export const CASE_PRIORITIES = [
  "critical",
  "high",
  "normal",
  "low",
] as const;

export type CasePriority = (typeof CASE_PRIORITIES)[number];

export const SIGNAL_TYPES = [
  "non_response",
  "unwell",
  "sos",
  "snow_report",
  "free_text",
  "crisis_no_response",
  "welfare_need_help",
  "manual",
  "external_api",
] as const;

export type SignalType = (typeof SIGNAL_TYPES)[number];

export const COMPLETION_OUTCOMES = [
  "confirmed_safe",
  "family_confirmed",
  "visit_completed",
  "support_connected",
  "supplies_delivered",
  "emergency_handoff_completed",
  "false_alarm",
  "declined",
  "other",
] as const;

export type CompletionOutcome = (typeof COMPLETION_OUTCOMES)[number];

export const EVIDENCE_KINDS = [
  "note",
  "call",
  "visit",
  "message",
  "external_ref",
] as const;

export type EvidenceKind =
  (typeof EVIDENCE_KINDS)[number];

export interface CompletionEvidenceItem {
  kind: EvidenceKind;
  ref: string;
}

export interface CompletionRecord {
  outcome: CompletionOutcome;
  summary: string;
  evidence: CompletionEvidenceItem[];
  completedBy: string;
  completedAt: string;
}

export interface CaseAggregate {
  id: string;
  tenantId: string;
  subjectId: string;
  sourceType: SignalType;
  sourceAdapter: string;
  sourceSignalId: string;
  priority: CasePriority;
  status: CaseStatus;
  version: number;
  assigneeId: string | null;
  handoffTargetId: string | null;
  createdAt: string;
  acknowledgedAt: string | null;
  assignedAt: string | null;
  firstActionAt: string | null;
  completedAt: string | null;
  closedAt: string | null;
  reopenedCount: number;
  completion: CompletionRecord | null;
}

interface EventBase {
  sequence: number;
  at: string;
  actorId: string | null;
}

export type CaseEvent =
  | (EventBase & {
      type: "case_created";
      data: {
        caseId: string;
        tenantId: string;
        subjectId: string;
        sourceType: SignalType;
        sourceAdapter: string;
        sourceSignalId: string;
        sourceEvidence?: SourceTranscriptEvidence;
        priority: CasePriority;
      };
    })
  | (EventBase & {
      type: "priority_changed";
      actorId: string;
      data: {
        previousPriority: CasePriority;
        priority: CasePriority;
      };
    })
  | (EventBase & {
      type: "acknowledged";
      actorId: string;
      data: Record<string, never>;
    })
  | (EventBase & {
      type: "assigned";
      actorId: string;
      data: { assigneeId: string };
    })
  | (EventBase & {
      type: "action_started";
      actorId: string;
      data: Record<string, never>;
    })
  | (EventBase & {
      type: "handoff_requested";
      actorId: string;
      data: { targetAssigneeId: string };
    })
  | (EventBase & {
      type: "handoff_accepted";
      actorId: string;
      data: { previousAssigneeId: string };
    })
  | (EventBase & {
      type: "completed";
      actorId: string;
      data: {
        outcome: CompletionOutcome;
        summary: string;
        evidence: CompletionEvidenceItem[];
      };
    })
  | (EventBase & {
      type: "closed";
      actorId: string;
      data: Record<string, never>;
    })
  | (EventBase & {
      type: "reopened";
      actorId: string;
      data: { reason: string };
    });

export type CaseCreatedEvent = Extract<CaseEvent, { type: "case_created" }>;

export const CASE_COMMAND_TYPES = [
  "set_priority",
  "acknowledge",
  "assign",
  "start_action",
  "request_handoff",
  "accept_handoff",
  "complete",
  "close",
  "reopen",
] as const;

export type CaseCommandType =
  (typeof CASE_COMMAND_TYPES)[number];

export type CaseCommand =
  | { type: "set_priority"; actorId: string; priority: CasePriority }
  | { type: "acknowledge"; actorId: string }
  | { type: "assign"; actorId: string; assigneeId: string }
  | { type: "start_action"; actorId: string }
  | { type: "request_handoff"; actorId: string; targetAssigneeId: string }
  | { type: "accept_handoff"; actorId: string }
  | {
      type: "complete";
      actorId: string;
      outcome: CompletionOutcome;
      summary: string;
      evidence: CompletionEvidenceItem[];
    }
  | { type: "close"; actorId: string }
  | { type: "reopen"; actorId: string; reason: string };

export interface NewCaseInput {
  sourceEvidence?: SourceTranscriptEvidence;
  id: string;
  tenantId: string;
  subjectId: string;
  sourceType: SignalType;
  sourceAdapter: string;
  sourceSignalId: string;
  priority: CasePriority;
  createdAt: string;
}
