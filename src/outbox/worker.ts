import type {
  OutboxDeliveryHandler,
  OutboxMessage,
  OutboxStore,
} from "./types.ts";

export interface RunOutboxOnceInput {
  tenantId: string;
  workerId: string;
  limit?: number;
  leaseSeconds?: number;
}

export interface OutboxRunResult {
  claimed: number;
  delivered: number;
  failed: number;
  unconfirmed: number;
}

export type OutboxClock = () => string;

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.slice(0, 1000);
  }
  return "delivery failed";
}

export class OutboxWorker {
  private readonly store: OutboxStore;
  private readonly handlers = new Map<
    string,
    OutboxDeliveryHandler
  >();
  private readonly retryDelayMs: number;
  private readonly now: OutboxClock;

  constructor(
    store: OutboxStore,
    handlers: readonly OutboxDeliveryHandler[],
    options: {
      retryDelayMs?: number;
      now?: OutboxClock;
    } = {},
  ) {
    this.store = store;
    this.retryDelayMs =
      options.retryDelayMs ?? 60_000;
    this.now =
      options.now ?? (() => new Date().toISOString());

    if (
      !Number.isFinite(this.retryDelayMs) ||
      this.retryDelayMs < 0
    ) {
      throw new Error(
        "retryDelayMs must be a non-negative number",
      );
    }

    for (const handler of handlers) {
      if (this.handlers.has(handler.topic)) {
        throw new Error(
          `Duplicate outbox handler topic: ${handler.topic}`,
        );
      }
      this.handlers.set(handler.topic, handler);
    }
  }

  private retryAt(): string {
    const nowMs = Date.parse(this.now());
    if (!Number.isFinite(nowMs)) {
      throw new Error("Outbox worker clock is invalid");
    }
    return new Date(
      nowMs + this.retryDelayMs,
    ).toISOString();
  }

  private async failMessage(
    input: RunOutboxOnceInput,
    message: OutboxMessage,
    error: unknown,
  ): Promise<boolean> {
    const result = await this.store.fail({
      tenantId: input.tenantId,
      id: message.id,
      workerId: input.workerId,
      error: errorMessage(error),
      retryAt: this.retryAt(),
    });

    return result.ok;
  }

  async runOnce(
    input: RunOutboxOnceInput,
  ): Promise<OutboxRunResult> {
    const claimed = await this.store.claim({
      tenantId: input.tenantId,
      workerId: input.workerId,
      limit: input.limit,
      leaseSeconds: input.leaseSeconds,
    });

    const result: OutboxRunResult = {
      claimed: claimed.length,
      delivered: 0,
      failed: 0,
      unconfirmed: 0,
    };

    for (const message of claimed) {
      const handler = this.handlers.get(
        message.topic,
      );

      if (!handler) {
        const failed = await this.failMessage(
          input,
          message,
          new Error(
            `No outbox handler for topic: ${message.topic}`,
          ),
        );
        if (failed) {
          result.failed += 1;
        } else {
          result.unconfirmed += 1;
        }
        continue;
      }

      try {
        await handler.deliver(message);

        const completed = await this.store.complete({
          tenantId: input.tenantId,
          id: message.id,
          workerId: input.workerId,
        });

        if (completed) {
          result.delivered += 1;
        } else {
          result.unconfirmed += 1;
        }
      } catch (error) {
        const failed = await this.failMessage(
          input,
          message,
          error,
        );

        if (failed) {
          result.failed += 1;
        } else {
          result.unconfirmed += 1;
        }
      }
    }

    return result;
  }
}
