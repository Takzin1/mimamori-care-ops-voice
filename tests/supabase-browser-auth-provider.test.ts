import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  SupabaseBrowserAuthProviderError,
  SupabaseBrowserAuthSessionProvider,
  type SupabaseBrowserAuthClientLike,
  type SupabaseBrowserSessionLike,
} from "../src/index.ts";

class FakeAuth
implements SupabaseBrowserAuthClientLike {
  session: SupabaseBrowserSessionLike | null =
    null;

  getSessionError = false;
  signOutError = false;
  getSessionCalls = 0;
  signOutCalls = 0;
  unsubscribeCalls = 0;

  listener:
    | ((
        event: string,
        session:
          SupabaseBrowserSessionLike | null,
      ) => void)
    | null = null;

  async getSession() {
    this.getSessionCalls += 1;

    return {
      data: {
        session: this.session,
      },
      error: this.getSessionError
        ? { message: "provider error" }
        : null,
    };
  }

  async signOut() {
    this.signOutCalls += 1;

    return {
      error: this.signOutError
        ? { message: "sign out failed" }
        : null,
    };
  }

  onAuthStateChange(
    callback: (
      event: string,
      session:
        SupabaseBrowserSessionLike | null,
    ) => void,
  ) {
    this.listener = callback;

    return {
      data: {
        subscription: {
          unsubscribe: () => {
            this.unsubscribeCalls += 1;
          },
        },
      },
    };
  }

  emit(
    session:
      SupabaseBrowserSessionLike | null,
  ) {
    this.session = session;
    this.listener?.(
      session ? "SIGNED_IN" : "SIGNED_OUT",
      session,
    );
  }
}

test("Supabase browser provider exposes safe status and fresh access token", async () => {
  const auth = new FakeAuth();
  auth.session = {
    access_token: "token-one",
    expires_at: 1_800_000_000,
  };

  const provider =
    new SupabaseBrowserAuthSessionProvider(
      auth,
    );

  const status =
    await provider.currentStatus();

  assert.deepEqual(status, {
    status: "authenticated",
    expiresAt:
      new Date(
        1_800_000_000 * 1000,
      ).toISOString(),
  });

  assert.equal(
    Object.hasOwn(status, "access_token"),
    false,
  );

  const first =
    await provider.accessToken();
  assert.equal(first, "token-one");

  auth.session = {
    access_token: "token-two",
  };

  const second =
    await provider.accessToken();

  assert.equal(second, "token-two");
  assert.equal(auth.getSessionCalls, 3);
});

test("Supabase browser provider fails closed on session lookup errors", async () => {
  const auth = new FakeAuth();
  const provider =
    new SupabaseBrowserAuthSessionProvider(
      auth,
    );

  auth.getSessionError = true;

  await assert.rejects(
    provider.currentStatus(),
    SupabaseBrowserAuthProviderError,
  );

  assert.equal(
    await provider.accessToken(),
    null,
  );
});

test("Supabase browser provider delegates sign-out and preserves failure", async () => {
  const auth = new FakeAuth();
  const provider =
    new SupabaseBrowserAuthSessionProvider(
      auth,
    );

  await provider.signOut();
  assert.equal(auth.signOutCalls, 1);

  auth.signOutError = true;

  await assert.rejects(
    provider.signOut(),
    SupabaseBrowserAuthProviderError,
  );

  assert.equal(auth.signOutCalls, 2);
});

test("Supabase browser provider maps auth-state events without exposing token", () => {
  const auth = new FakeAuth();
  const provider =
    new SupabaseBrowserAuthSessionProvider(
      auth,
    );

  const observed: unknown[] = [];
  const unsubscribe =
    provider.subscribe(
      (status) => {
        observed.push(status);
      },
    );

  auth.emit({
    access_token: "event-token",
    expires_at: 1_800_000_100,
  });
  auth.emit(null);

  assert.deepEqual(observed, [
    {
      status: "authenticated",
      expiresAt:
        new Date(
          1_800_000_100 * 1000,
        ).toISOString(),
    },
    {
      status: "signed_out",
      expiresAt: null,
    },
  ]);

  assert.equal(
    JSON.stringify(observed).includes(
      "event-token",
    ),
    false,
  );

  unsubscribe();
  assert.equal(auth.unsubscribeCalls, 1);
});

test("Supabase browser Auth bridge contains no persistence or service-role primitive", async () => {
  const source = await readFile(
    new URL(
      "../src/session/supabase-browser-auth-provider.ts",
      import.meta.url,
    ),
    "utf8",
  );

  for (const forbidden of [
    "localStorage",
    "sessionStorage",
    "document.cookie",
    "indexedDB",
    "serviceRole",
    "service_role",
    "principalId",
    "actorId",
  ]) {
    assert.equal(
      source.includes(forbidden),
      false,
      `${forbidden} must not be owned by the browser Auth bridge`,
    );
  }
});
