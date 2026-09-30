import type {
  BrowserAuthSessionListener,
  BrowserAuthSessionProvider,
  BrowserAuthSessionStatus,
} from "./types.ts";

export interface SupabaseBrowserSessionLike {
  access_token: string;
  expires_at?: number | null;
}

export interface SupabaseBrowserAuthClientLike {
  getSession(): Promise<{
    data: {
      session: SupabaseBrowserSessionLike | null;
    };
    error?: {
      message?: string;
    } | null;
  }>;

  signOut(): Promise<{
    error?: {
      message?: string;
    } | null;
  }>;

  onAuthStateChange(
    callback: (
      event: string,
      session: SupabaseBrowserSessionLike | null,
    ) => void,
  ): {
    data: {
      subscription: {
        unsubscribe(): void;
      };
    };
  };
}

export class SupabaseBrowserAuthProviderError
extends Error {
  readonly code =
    "SUPABASE_BROWSER_AUTH_PROVIDER_ERROR";

  constructor(
    operation: "currentStatus" | "signOut",
  ) {
    super(
      `Supabase Auth ${operation} failed`,
    );
    this.name =
      "SupabaseBrowserAuthProviderError";
  }
}

function expiresAt(
  session: SupabaseBrowserSessionLike,
): string | null {
  const value = session.expires_at;

  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value <= 0
  ) {
    return null;
  }

  return new Date(
    value * 1000,
  ).toISOString();
}

function statusFromSession(
  session: SupabaseBrowserSessionLike | null,
): BrowserAuthSessionStatus {
  if (
    !session ||
    typeof session.access_token !== "string" ||
    !session.access_token
  ) {
    return {
      status: "signed_out",
      expiresAt: null,
    };
  }

  return {
    status: "authenticated",
    expiresAt: expiresAt(session),
  };
}

export class SupabaseBrowserAuthSessionProvider
implements BrowserAuthSessionProvider {
  readonly #auth:
    SupabaseBrowserAuthClientLike;

  constructor(
    auth: SupabaseBrowserAuthClientLike,
  ) {
    this.#auth = auth;
  }

  async currentStatus():
  Promise<BrowserAuthSessionStatus> {
    const result =
      await this.#auth.getSession();

    if (result.error) {
      throw new SupabaseBrowserAuthProviderError(
        "currentStatus",
      );
    }

    return statusFromSession(
      result.data.session,
    );
  }

  async accessToken():
  Promise<string | null> {
    const result =
      await this.#auth.getSession();

    if (result.error) {
      return null;
    }

    const session =
      result.data.session;

    if (
      !session ||
      typeof session.access_token !==
        "string" ||
      !session.access_token
    ) {
      return null;
    }

    return session.access_token;
  }

  async signOut(): Promise<void> {
    const result =
      await this.#auth.signOut();

    if (result.error) {
      throw new SupabaseBrowserAuthProviderError(
        "signOut",
      );
    }
  }

  subscribe(
    listener: BrowserAuthSessionListener,
  ): () => void {
    const result =
      this.#auth.onAuthStateChange(
        (_event, session) => {
          listener(
            statusFromSession(session),
          );
        },
      );

    return () => {
      result.data.subscription.unsubscribe();
    };
  }
}
