import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CareOpsHttpClientError,
  CareOpsSessionController,
  CareOpsSessionDisposedError,
  CareOpsSessionUnavailableError,
  type BrowserAuthSessionListener,
  type BrowserAuthSessionProvider,
  type BrowserAuthSessionStatus,
} from "../src/index.ts";

class FakeSessionProvider
implements BrowserAuthSessionProvider {
  status: BrowserAuthSessionStatus = {
    status: "signed_out",
  };

  tokens: Array<string | null> = [];
  tokenCalls = 0;
  signOutCalls = 0;

  readonly listeners =
    new Set<BrowserAuthSessionListener>();

  currentStatus(): BrowserAuthSessionStatus {
    return this.status;
  }

  accessToken(): string | null {
    const token =
      this.tokens[this.tokenCalls] ??
      this.tokens.at(-1) ??
      null;

    this.tokenCalls += 1;
    return token;
  }

  signOut(): void {
    this.signOutCalls += 1;
    this.emit({ status: "signed_out" });
  }

  subscribe(
    listener: BrowserAuthSessionListener,
  ): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(
    status: BrowserAuthSessionStatus,
  ): void {
    this.status = status;
    for (const listener of this.listeners) {
      listener(status);
    }
  }
}

function jsonResponse(
  value: unknown,
  status = 200,
): Response {
  return new Response(
    JSON.stringify(value),
    {
      status,
      headers: {
        "content-type": "application/json",
      },
    },
  );
}

test("session snapshot never contains tokens and fresh token is requested per API call", async () => {
  const provider = new FakeSessionProvider();
  provider.status = {
    status: "authenticated",
    expiresAt: "2026-09-26T03:00:00.000Z",
  };
  provider.tokens = [
    "access-token-one",
    "access-token-two",
  ];

  const seenAuth: string[] = [];

  const controller =
    new CareOpsSessionController({
      baseUrl: "https://care.example.test",
      provider,
      fetchImpl: async (
        _input,
        init = {},
      ) => {
        const headers = new Headers(
          init.headers,
        );
        seenAuth.push(
          headers.get("authorization") ?? "",
        );

        assert.equal(
          init.credentials,
          "omit",
        );
        assert.equal(
          init.cache,
          "no-store",
        );

        return jsonResponse({
          tenantId: "provider-a",
          evaluatedAt:
            "2026-09-26T02:00:00.000Z",
          items: [],
          summary: {
            total: 0,
            breached: 0,
            unacknowledged: 0,
            unassigned: 0,
            handoffPending: 0,
            byPriority: {
              critical: 0,
              high: 0,
              normal: 0,
              low: 0,
            },
          },
        });
      },
    });

  const initial =
    await controller.initialize();

  assert.deepEqual(initial, {
    state: "ready",
    expiresAt: "2026-09-26T03:00:00.000Z",
    generation: 1,
  });

  await controller.queue("provider-a");
  await controller.queue("provider-a");

  assert.equal(provider.tokenCalls, 2);
  assert.deepEqual(seenAuth, [
    "Bearer access-token-one",
    "Bearer access-token-two",
  ]);

  const serialized =
    JSON.stringify(controller);

  assert.equal(
    serialized.includes("access-token"),
    false,
  );
  assert.equal(
    JSON.stringify(controller.snapshot())
      .includes("access-token"),
    false,
  );
});

test("401 moves session to reauthentication-required and mutation is not replayed", async () => {
  const provider = new FakeSessionProvider();
  provider.status = {
    status: "authenticated",
  };
  provider.tokens = ["expired-token"];

  let fetchCalls = 0;

  const controller =
    new CareOpsSessionController({
      baseUrl: "https://care.example.test",
      provider,
      fetchImpl: async () => {
        fetchCalls += 1;
        return jsonResponse(
          {
            error: {
              code:
                "AUTHENTICATION_REQUIRED",
              message:
                "Authentication required",
              requestId: "req-401",
            },
          },
          401,
        );
      },
    });

  await controller.initialize();

  await assert.rejects(
    controller.execute(
      "provider-a",
      "case-a",
      1,
      { type: "acknowledge" },
    ),
    (error: unknown) =>
      error instanceof CareOpsHttpClientError &&
      error.status === 401,
  );

  assert.equal(fetchCalls, 1);
  assert.deepEqual(
    controller.snapshot(),
    {
      state:
        "reauthentication_required",
      expiresAt: null,
      generation: 2,
    },
  );

  await assert.rejects(
    controller.execute(
      "provider-a",
      "case-a",
      1,
      { type: "acknowledge" },
    ),
    CareOpsSessionUnavailableError,
  );

  assert.equal(
    fetchCalls,
    1,
    "failed mutation must not be automatically replayed",
  );
});

test("403 is an authorization result and does not destroy the authenticated session", async () => {
  const provider = new FakeSessionProvider();
  provider.status = {
    status: "authenticated",
  };
  provider.tokens = ["valid-token"];

  const controller =
    new CareOpsSessionController({
      baseUrl: "https://care.example.test",
      provider,
      fetchImpl: async () =>
        jsonResponse(
          {
            error: {
              code: "FORBIDDEN",
              message: "Access denied",
              requestId: "req-403",
            },
          },
          403,
        ),
    });

  await controller.initialize();

  await assert.rejects(
    controller.queue("provider-a"),
    (error: unknown) =>
      error instanceof CareOpsHttpClientError &&
      error.status === 403,
  );

  assert.equal(
    controller.snapshot().state,
    "ready",
  );
});

test("provider state events can restore ready state without exposing token state", async () => {
  const provider = new FakeSessionProvider();
  const controller =
    new CareOpsSessionController({
      baseUrl: "https://care.example.test",
      provider,
      fetchImpl: async () =>
        jsonResponse({}),
    });

  await controller.initialize();

  const observed: string[] = [];
  const unsubscribe =
    controller.subscribe(
      (snapshot) => {
        observed.push(snapshot.state);
      },
    );

  provider.emit({
    status: "authenticated",
    expiresAt:
      "2026-09-26T04:00:00.000Z",
  });

  assert.equal(
    controller.snapshot().state,
    "ready",
  );

  provider.emit({
    status: "signed_out",
  });

  assert.equal(
    controller.snapshot().state,
    "signed_out",
  );

  assert.deepEqual(
    observed,
    ["ready", "signed_out"],
  );

  unsubscribe();
});

test("missing token fails closed and sign-out delegates to provider", async () => {
  const provider = new FakeSessionProvider();
  provider.status = {
    status: "authenticated",
  };
  provider.tokens = [null];

  const controller =
    new CareOpsSessionController({
      baseUrl: "https://care.example.test",
      provider,
      fetchImpl: async () => {
        throw new Error(
          "fetch must not be called",
        );
      },
    });

  await controller.initialize();

  await assert.rejects(
    controller.queue("provider-a"),
    CareOpsSessionUnavailableError,
  );

  assert.equal(
    controller.snapshot().state,
    "reauthentication_required",
  );

  provider.emit({
    status: "authenticated",
  });

  assert.equal(
    controller.snapshot().state,
    "ready",
  );

  await controller.signOut();

  assert.equal(provider.signOutCalls, 1);
  assert.equal(
    controller.snapshot().state,
    "signed_out",
  );
});

test("disposed controller unsubscribes and rejects further use", async () => {
  const provider = new FakeSessionProvider();
  provider.status = {
    status: "authenticated",
  };

  const controller =
    new CareOpsSessionController({
      baseUrl: "https://care.example.test",
      provider,
      fetchImpl: async () =>
        jsonResponse({}),
    });

  await controller.initialize();
  assert.equal(provider.listeners.size, 1);

  controller.dispose();

  assert.equal(provider.listeners.size, 0);

  assert.throws(
    () => controller.snapshot(),
    CareOpsSessionDisposedError,
  );

  await assert.rejects(
    controller.queue("provider-a"),
    CareOpsSessionDisposedError,
  );
});

test("session module contains no ambient browser persistence API", async () => {
  const source = await readFile(
    new URL(
      "../src/session/care-ops-session-controller.ts",
      import.meta.url,
    ),
    "utf8",
  );

  for (const forbidden of [
    "localStorage",
    "sessionStorage",
    "document.cookie",
    "indexedDB",
  ]) {
    assert.equal(
      source.includes(forbidden),
      false,
      `${forbidden} must not be referenced by the session controller`,
    );
  }
});
