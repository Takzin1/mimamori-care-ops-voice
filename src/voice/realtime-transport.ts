import type {
  VoiceRealtimeSession,
} from "./realtime-session.ts";

export type VoiceTransportState =
  | "idle"
  | "connecting"
  | "open"
  | "closed"
  | "error";

export interface VoiceRealtimeSocket {
  readyState: number;
  binaryType: BinaryType;
  onopen:
    | ((event: Event) => void)
    | null;
  onmessage:
    | ((event: MessageEvent) => void)
    | null;
  onerror:
    | ((event: Event) => void)
    | null;
  onclose:
    | ((event: CloseEvent) => void)
    | null;
  send(
    data:
      | string
      | ArrayBufferLike
      | Blob
      | ArrayBufferView,
  ): void;
  close(
    code?: number,
    reason?: string,
  ): void;
}

export type VoiceRealtimeSocketFactory = (
  url: string,
) => VoiceRealtimeSocket;

export interface VoiceRealtimeTransportHandlers {
  onState?(
    state: VoiceTransportState,
  ): void;
  onMessage?(
    data: unknown,
  ): void;
  onError?(
    error: Error,
  ): void;
}

export class VoiceRealtimeTransport {
  readonly #session:
    VoiceRealtimeSession;
  readonly #factory:
    VoiceRealtimeSocketFactory;
  readonly #handlers:
    VoiceRealtimeTransportHandlers;
  #socket:
    VoiceRealtimeSocket | null = null;
  #state:
    VoiceTransportState = "idle";

  constructor(input: {
    session: VoiceRealtimeSession;
    socketFactory:
      VoiceRealtimeSocketFactory;
    handlers?:
      VoiceRealtimeTransportHandlers;
  }) {
    this.#session =
      input.session;
    this.#factory =
      input.socketFactory;
    this.#handlers =
      input.handlers ?? {};
  }

  get state():
    VoiceTransportState {
    return this.#state;
  }

  private setState(
    next: VoiceTransportState,
  ): void {
    this.#state = next;
    this.#handlers.onState?.(
      next,
    );
  }

  connect(): void {
    if (
      this.#state !== "idle" &&
      this.#state !== "closed"
    ) {
      throw new Error(
        "voice realtime transport is already active",
      );
    }

    this.setState(
      "connecting",
    );

    let socket:
      VoiceRealtimeSocket;

    try {
      socket = this.#factory(
        this.#session.websocketUrl,
      );
    } catch (error) {
      this.setState(
        "error",
      );

      const normalized =
        error instanceof Error
          ? error
          : new Error(
              "voice realtime socket creation failed",
            );

      this.#handlers.onError?.(
        normalized,
      );
      throw normalized;
    }

    socket.binaryType =
      "arraybuffer";
    this.#socket =
      socket;

    socket.onopen = () => {
      this.setState(
        "open",
      );
    };

    socket.onmessage = (
      event,
    ) => {
      this.#handlers.onMessage?.(
        event.data,
      );
    };

    socket.onerror = () => {
      this.setState(
        "error",
      );
      this.#handlers.onError?.(
        new Error(
          "voice realtime websocket error",
        ),
      );
    };

    socket.onclose = () => {
      this.setState(
        "closed",
      );
      this.#socket =
        null;
    };
  }

  sendAudio(
    chunk: Uint8Array,
  ): void {
    if (
      this.#state !== "open" ||
      !this.#socket
    ) {
      throw new Error(
        "voice realtime transport is not open",
      );
    }

    if (
      chunk.byteLength < 1
    ) {
      throw new Error(
        "voice audio chunk must not be empty",
      );
    }

    this.#socket.send(
      chunk,
    );
  }

  close(
    code = 1000,
    reason = "client complete",
  ): void {
    if (!this.#socket) {
      if (
        this.#state !== "closed"
      ) {
        this.setState(
          "closed",
        );
      }
      return;
    }

    this.#socket.close(
      code,
      reason,
    );
  }
}

export function browserWebSocketFactory(
  url: string,
): VoiceRealtimeSocket {
  return new WebSocket(
    url,
  );
}
