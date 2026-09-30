import {
  applyEvent,
  replayCase,
} from "../core/case-core.ts";
import { CaseConflictError } from "../core/errors.ts";
import type {
  CaseAggregate,
  CaseCreatedEvent,
  CaseEvent,
} from "../core/types.ts";
import {
  CaseNotFoundError,
  DuplicateCaseError,
  SignalReplayMismatchError,
} from "./errors.ts";
import type {
  AppendCaseEventInput,
  CaseRepository,
  CreateCaseResult,
  StoredCase,
} from "./types.ts";

interface InternalRecord {
  aggregate: CaseAggregate;
  events: CaseEvent[];
}

function key(tenantId: string, caseId: string): string {
  return `${tenantId}\u0000${caseId}`;
}

function signalKey(event: CaseCreatedEvent): string {
  return [
    event.data.tenantId,
    event.data.sourceAdapter,
    event.data.sourceSignalId,
  ].join("\u0000");
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function assertReplayCompatible(
  record: InternalRecord,
  event: CaseCreatedEvent,
): void {
  const current = record.aggregate;

  if (
    current.tenantId !== event.data.tenantId ||
    current.sourceAdapter !== event.data.sourceAdapter ||
    current.sourceSignalId !== event.data.sourceSignalId ||
    current.subjectId !== event.data.subjectId ||
    current.sourceType !== event.data.sourceType
  ) {
    throw new SignalReplayMismatchError(
      event.data.tenantId,
      event.data.sourceAdapter,
      event.data.sourceSignalId,
    );
  }
}

export class InMemoryCaseRepository implements CaseRepository {
  private readonly records = new Map<string, InternalRecord>();
  private readonly signalIndex = new Map<string, string>();

  async create(event: CaseCreatedEvent): Promise<CreateCaseResult> {
    const tenantId = event.data.tenantId;
    const caseId = event.data.caseId;
    const storageKey = key(tenantId, caseId);
    const idempotencyKey = signalKey(event);
    const existingStorageKey = this.signalIndex.get(idempotencyKey);

    if (existingStorageKey) {
      const existing = this.records.get(existingStorageKey);
      if (!existing) {
        throw new Error("Signal index points to a missing Case");
      }

      assertReplayCompatible(existing, event);

      const original = existing.events[0];
      if (!original || original.type !== "case_created") {
        throw new Error("Stored Case is missing case_created event");
      }

      return {
        aggregate: clone(existing.aggregate),
        event: clone(original),
        created: false,
      };
    }

    if (this.records.has(storageKey)) {
      throw new DuplicateCaseError(tenantId, caseId);
    }

    const aggregate = replayCase([event]);
    this.records.set(storageKey, {
      aggregate: clone(aggregate),
      events: [clone(event)],
    });
    this.signalIndex.set(idempotencyKey, storageKey);

    return {
      aggregate: clone(aggregate),
      event: clone(event),
      created: true,
    };
  }

  async load(tenantId: string, caseId: string): Promise<StoredCase | null> {
    const record = this.records.get(key(tenantId, caseId));
    if (!record) return null;

    return {
      aggregate: clone(record.aggregate),
      events: clone(record.events),
    };
  }

  async list(tenantId: string): Promise<StoredCase[]> {
    const results: StoredCase[] = [];

    for (const record of this.records.values()) {
      if (record.aggregate.tenantId !== tenantId) continue;

      results.push({
        aggregate: clone(record.aggregate),
        events: clone(record.events),
      });
    }

    return results;
  }

  async append(input: AppendCaseEventInput): Promise<CaseAggregate> {
    const storageKey = key(input.tenantId, input.caseId);
    const record = this.records.get(storageKey);

    if (!record) {
      throw new CaseNotFoundError(input.tenantId, input.caseId);
    }

    if (record.aggregate.version !== input.expectedVersion) {
      throw new CaseConflictError(
        input.expectedVersion,
        record.aggregate.version,
      );
    }

    const nextAggregate = applyEvent(record.aggregate, input.event);

    if (
      nextAggregate.tenantId !== input.tenantId ||
      nextAggregate.id !== input.caseId
    ) {
      throw new CaseNotFoundError(input.tenantId, input.caseId);
    }

    const nextEvents = [...record.events, clone(input.event)];

    this.records.set(storageKey, {
      aggregate: clone(nextAggregate),
      events: nextEvents,
    });

    return clone(nextAggregate);
  }
}
