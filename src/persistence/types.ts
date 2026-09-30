import type {
  CaseAggregate,
  CaseCreatedEvent,
  CaseEvent,
} from "../core/types.ts";

export interface StoredCase {
  aggregate: CaseAggregate;
  events: readonly CaseEvent[];
}

export interface CreateCaseResult {
  aggregate: CaseAggregate;
  event: CaseCreatedEvent;
  created: boolean;
}

export interface AppendCaseEventInput {
  tenantId: string;
  caseId: string;
  expectedVersion: number;
  event: CaseEvent;
}

export interface CaseRepository {
  create(event: CaseCreatedEvent): Promise<CreateCaseResult>;
  load(tenantId: string, caseId: string): Promise<StoredCase | null>;
  list(tenantId: string): Promise<StoredCase[]>;
  append(input: AppendCaseEventInput): Promise<CaseAggregate>;
}
