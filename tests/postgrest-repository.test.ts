import assert from "node:assert/strict";
import test from "node:test";

import {
  CaseConflictError,
  CaseStoreCorruptionError,
  DuplicateCaseError,
  PostgrestCaseRepository,
  SignalReplayMismatchError,
  createCase,
  executeCommand,
} from "../src/index.ts";

function jsonResponse(
  value: unknown,
  status = 200,
): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createdFixture() {
  return createCase({
    id: "case-postgrest",
    tenantId: "provider-a",
    sourceAdapter: "test-adapter",
    sourceSignalId: "signal-postgrest",
    subjectId: "subject-postgrest",
    sourceType: "non_response",
    priority: "normal",
    createdAt: "2026-09-25T05:00:00.000Z",
  });
}

test("PostgREST adapter maps create, load and append", async () => {
  const created = createdFixture();
  let snapshot = created.aggregate;
  let events = [created.event];
  const calls: Array<{
    url: URL;
    init: RequestInit;
  }> = [];

  const fetchImpl = async (
    input: string | URL,
    init: RequestInit = {},
  ): Promise<Response> => {
    const url = new URL(input.toString());
    calls.push({ url, init });

    const headers = new Headers(init.headers);
    assert.equal(headers.get("apikey"), "service-secret");
    assert.equal(
      headers.get("authorization"),
      "Bearer service-secret",
    );

    if (url.pathname.endsWith("/rpc/create_care_case")) {
      const body = JSON.parse(String(init.body));
      snapshot = body.p_snapshot;
      events = [body.p_event];
      return jsonResponse({
        ok: true,
        created: true,
        caseId: snapshot.id,
        version: 1,
        snapshot,
      });
    }

    if (
      url.pathname.endsWith(
        "/rpc/append_care_case_event",
      )
    ) {
      const body = JSON.parse(String(init.body));
      snapshot = body.p_snapshot;
      events.push(body.p_event);
      return jsonResponse({
        ok: true,
        version: snapshot.version,
      });
    }

    if (url.pathname.endsWith("/care_cases")) {
      return jsonResponse([
        {
          case_id: snapshot.id,
          snapshot,
        },
      ]);
    }

    if (url.pathname.endsWith("/care_case_events")) {
      return jsonResponse(
        events.map((event) => ({
          case_id: snapshot.id,
          sequence: event.sequence,
          event,
        })),
      );
    }

    return jsonResponse({ message: "not found" }, 404);
  };

  const repository = new PostgrestCaseRepository({
    baseUrl: "https://example.supabase.co",
    serviceRoleKey: "service-secret",
    fetchImpl,
  });

  const opened = await repository.create(created.event);
  assert.equal(opened.created, true);
  assert.equal(opened.aggregate.status, "NEW");

  const acknowledged = executeCommand(
    opened.aggregate,
    1,
    { type: "acknowledge", actorId: "dispatcher" },
    "2026-09-25T05:02:00.000Z",
  );

  const appended = await repository.append({
    tenantId: "provider-a",
    caseId: "case-postgrest",
    expectedVersion: 1,
    event: acknowledged.event,
  });
  assert.equal(appended.status, "ACKNOWLEDGED");
  assert.equal(appended.version, 2);

  const loaded = await repository.load(
    "provider-a",
    "case-postgrest",
  );
  assert.equal(loaded?.aggregate.status, "ACKNOWLEDGED");
  assert.equal(loaded?.events.length, 2);

  assert.ok(
    calls.some((call) =>
      call.url.pathname.endsWith(
        "/rpc/create_care_case",
      ),
    ),
  );
  assert.ok(
    calls.some((call) =>
      call.url.pathname.endsWith(
        "/rpc/append_care_case_event",
      ),
    ),
  );
});

test("PostgREST adapter maps database conflict responses", async () => {
  const created = createdFixture();

  const fetchImpl = async (
    input: string | URL,
  ): Promise<Response> => {
    const url = new URL(input.toString());

    if (url.pathname.endsWith("/care_cases")) {
      return jsonResponse([
        {
          case_id: created.aggregate.id,
          snapshot: created.aggregate,
        },
      ]);
    }

    if (url.pathname.endsWith("/care_case_events")) {
      return jsonResponse([
        {
          case_id: created.aggregate.id,
          sequence: 1,
          event: created.event,
        },
      ]);
    }

    if (
      url.pathname.endsWith(
        "/rpc/append_care_case_event",
      )
    ) {
      return jsonResponse({
        ok: false,
        conflict: true,
        currentVersion: 2,
      });
    }

    return jsonResponse({ message: "not found" }, 404);
  };

  const repository = new PostgrestCaseRepository({
    baseUrl: "https://example.supabase.co",
    serviceRoleKey: "service-secret",
    fetchImpl,
  });

  const transition = executeCommand(
    created.aggregate,
    1,
    { type: "acknowledge", actorId: "dispatcher" },
    "2026-09-25T05:02:00.000Z",
  );

  await assert.rejects(
    repository.append({
      tenantId: "provider-a",
      caseId: "case-postgrest",
      expectedVersion: 1,
      event: transition.event,
    }),
    CaseConflictError,
  );
});

test("PostgREST adapter maps idempotency mismatch and duplicate Case", async () => {
  const created = createdFixture();

  const mismatch = new PostgrestCaseRepository({
    baseUrl: "https://example.supabase.co",
    serviceRoleKey: "service-secret",
    fetchImpl: async () =>
      jsonResponse({
        ok: false,
        conflict: true,
        reason: "signal_replay_mismatch",
        caseId: "case-existing",
      }),
  });

  await assert.rejects(
    mismatch.create(created.event),
    SignalReplayMismatchError,
  );

  const duplicate = new PostgrestCaseRepository({
    baseUrl: "https://example.supabase.co",
    serviceRoleKey: "service-secret",
    fetchImpl: async () =>
      jsonResponse(
        { code: "23505", message: "unique violation" },
        409,
      ),
  });

  await assert.rejects(
    duplicate.create(created.event),
    DuplicateCaseError,
  );
});

test("PostgREST adapter rejects snapshot/event divergence", async () => {
  const created = createdFixture();
  const corrupted = {
    ...created.aggregate,
    status: "ACKNOWLEDGED",
    version: 2,
  };

  const repository = new PostgrestCaseRepository({
    baseUrl: "https://example.supabase.co",
    serviceRoleKey: "service-secret",
    fetchImpl: async (input) => {
      const url = new URL(input.toString());

      if (url.pathname.endsWith("/care_cases")) {
        return jsonResponse([
          {
            case_id: created.aggregate.id,
            snapshot: corrupted,
          },
        ]);
      }

      return jsonResponse([
        {
          case_id: created.aggregate.id,
          sequence: 1,
          event: created.event,
        },
      ]);
    },
  });

  await assert.rejects(
    repository.load("provider-a", "case-postgrest"),
    CaseStoreCorruptionError,
  );
});

test("PostgREST adapter paginates tenant lists", async () => {
  const cases = ["case-a", "case-b"].map((id, index) =>
    createCase({
      id,
      tenantId: "provider-a",
      sourceAdapter: "test-adapter",
      sourceSignalId: `signal-${id}`,
      subjectId: `subject-${id}`,
      sourceType: "manual",
      priority: index === 0 ? "high" : "normal",
      createdAt: "2026-09-25T05:00:00.000Z",
    }),
  );

  const repository = new PostgrestCaseRepository({
    baseUrl: "https://example.supabase.co",
    serviceRoleKey: "service-secret",
    pageSize: 1,
    fetchImpl: async (input) => {
      const url = new URL(input.toString());
      const offset = Number(
        url.searchParams.get("offset") ?? "0",
      );

      if (url.pathname.endsWith("/care_cases")) {
        const item = cases[offset];
        return jsonResponse(
          item
            ? [{
                case_id: item.aggregate.id,
                snapshot: item.aggregate,
              }]
            : [],
        );
      }

      const item = cases[offset];
      return jsonResponse(
        item
          ? [{
              case_id: item.aggregate.id,
              sequence: 1,
              event: item.event,
            }]
          : [],
      );
    },
  });

  const listed = await repository.list("provider-a");
  assert.deepEqual(
    listed.map((item) => item.aggregate.id),
    ["case-a", "case-b"],
  );
});
