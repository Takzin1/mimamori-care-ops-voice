import {
  OutboxWorker,
  type OutboxClock,
} from "../outbox/worker.ts";
import type {
  OutboxStore,
} from "../outbox/types.ts";
import {
  ApprovedCommunicationOutboxHandler,
  type ApprovedCommunicationSender,
} from "./communication-delivery.ts";

export interface VoiceCommunicationWorkerOptions {
  store: OutboxStore;
  sender:
    ApprovedCommunicationSender;
  retryDelayMs?: number;
  now?: OutboxClock;
}

export function createVoiceCommunicationWorker(
  options:
    VoiceCommunicationWorkerOptions,
): OutboxWorker {
  return new OutboxWorker(
    options.store,
    [
      new ApprovedCommunicationOutboxHandler(
        options.sender,
      ),
    ],
    {
      retryDelayMs:
        options.retryDelayMs,
      now:
        options.now,
    },
  );
}
