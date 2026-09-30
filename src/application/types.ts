import type {
  CaseAggregate,
  CaseCommand,
  CaseEvent,
  CasePriority,
  SignalType,
  SourceTranscriptEvidence,
} from "../core/types.ts";

export interface AttentionSignal {
  sourceEvidence?: SourceTranscriptEvidence;
  id: string;
  tenantId: string;
  sourceAdapter: string;
  subjectId: string;
  type: SignalType;
  priority: CasePriority;
}

type WithoutActor<T> = T extends { actorId: string }
  ? Omit<T, "actorId">
  : never;

export type CaseCommandIntent = WithoutActor<CaseCommand>;

export interface ExecuteCaseCommandInput {
  tenantId: string;
  caseId: string;
  principalId: string;
  expectedVersion: number;
  command: CaseCommandIntent;
}

export interface CaseQueryInput {
  tenantId: string;
  caseId: string;
  principalId: string;
}

export interface CaseOpenResult {
  aggregate: CaseAggregate;
  event: Extract<CaseEvent, { type: "case_created" }>;
  created: boolean;
}

export interface CaseOperationResult {
  aggregate: CaseAggregate;
  event: CaseEvent;
}
