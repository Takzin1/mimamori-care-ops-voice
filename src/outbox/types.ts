export type OutboxStatus =
  | "pending"
  | "processing"
  | "failed"
  | "delivered"
  | "dead_letter";

export interface OutboxMessage {
  id: number;
  tenantId: string;
  topic: string;
  deliveryKey: string;
  payload: unknown;
  status: OutboxStatus;
  attemptCount: number;
  maxAttempts: number;
  availableAt: string;
  claimedAt: string | null;
  leaseUntil: string | null;
  workerId: string | null;
}

export interface EnqueueOutboxInput {
  tenantId: string;
  topic: string;
  deliveryKey: string;
  payload: unknown;
  availableAt?: string;
  maxAttempts?: number;
}

export interface EnqueueOutboxResult {
  created: boolean;
  id: number;
}

export interface ClaimOutboxInput {
  tenantId: string;
  workerId: string;
  limit?: number;
  leaseSeconds?: number;
}

export interface CompleteOutboxInput {
  tenantId: string;
  id: number;
  workerId: string;
}

export interface FailOutboxInput {
  tenantId: string;
  id: number;
  workerId: string;
  error: string;
  retryAt?: string;
}

export interface FailOutboxResult {
  ok: boolean;
  status: OutboxStatus | null;
}

export interface OutboxStore {
  enqueue(
    input: EnqueueOutboxInput,
  ): Promise<EnqueueOutboxResult>;

  claim(
    input: ClaimOutboxInput,
  ): Promise<OutboxMessage[]>;

  complete(
    input: CompleteOutboxInput,
  ): Promise<boolean>;

  fail(
    input: FailOutboxInput,
  ): Promise<FailOutboxResult>;
}

export interface OutboxDeliveryHandler {
  readonly topic: string;

  deliver(message: OutboxMessage): Promise<void>;
}
