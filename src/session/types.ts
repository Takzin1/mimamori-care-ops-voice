import type {
  CareOpsClient,
} from "../client/types.ts";

export type CareOpsSessionState =
  | "signed_out"
  | "ready"
  | "reauthentication_required";

export type BrowserAuthSessionStatus =
  | {
      status: "signed_out";
      expiresAt?: null;
    }
  | {
      status: "authenticated";
      expiresAt?: string | null;
    };

export type BrowserAuthSessionListener = (
  status: BrowserAuthSessionStatus,
) => void;

export interface BrowserAuthSessionProvider {
  currentStatus():
    | BrowserAuthSessionStatus
    | Promise<BrowserAuthSessionStatus>;

  accessToken():
    | string
    | null
    | Promise<string | null>;

  signOut(): void | Promise<void>;

  subscribe(
    listener: BrowserAuthSessionListener,
  ): () => void;
}

export interface CareOpsSessionSnapshot {
  state: CareOpsSessionState;
  expiresAt: string | null;
  generation: number;
}

export type CareOpsSessionListener = (
  snapshot: Readonly<CareOpsSessionSnapshot>,
) => void;

export interface CareOpsSessionControllerOptions {
  baseUrl: string;
  provider: BrowserAuthSessionProvider;
  fetchImpl?: typeof fetch;
}

export interface CareOpsSessionClient
extends CareOpsClient {
  initialize(): Promise<CareOpsSessionSnapshot>;

  snapshot(): CareOpsSessionSnapshot;

  subscribe(
    listener: CareOpsSessionListener,
  ): () => void;

  signOut(): Promise<void>;

  dispose(): void;
}
