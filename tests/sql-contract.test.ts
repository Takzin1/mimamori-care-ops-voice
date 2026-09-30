import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function sql(): Promise<string> {
  return readFile(
    new URL("../db/case_store.sql", import.meta.url),
    "utf8",
  );
}

test("Postgres Case Store uses tenant-scoped composite identities", async () => {
  const source = await sql();

  assert.ok(source.includes("primary key (tenant_id, case_id)"));
  assert.ok(
    source.includes("primary key (tenant_id, case_id, sequence)"),
  );
  assert.ok(
    source.includes("foreign key (tenant_id, case_id)"),
  );
  assert.ok(source.includes("on delete restrict"));
});

test("append RPC enforces compare-and-set under a row lock", async () => {
  const source = await sql();

  assert.ok(source.includes("append_care_case_event"));
  assert.ok(source.includes("for update;"));
  assert.ok(source.includes("v_current_version <> p_expected_version"));
  assert.ok(source.includes("'conflict', true"));
  assert.ok(source.includes("v_snapshot_version <> v_next_version"));
  assert.ok(source.includes("v_event_sequence <> v_next_version"));
});

test("snapshot advance and event append live in the same RPC", async () => {
  const source = await sql();
  const functionStart = source.indexOf(
    "create or replace function public.append_care_case_event",
  );
  assert.ok(functionStart >= 0);

  const body = source.slice(functionStart);
  const updateAt = body.indexOf("update public.care_cases");
  const eventAt = body.indexOf("insert into public.care_case_events");

  assert.ok(updateAt >= 0);
  assert.ok(eventAt > updateAt);
});

test("Data API access is fail-closed to server-side service role", async () => {
  const source = await sql();

  assert.ok(
    source.includes(
      "alter table public.care_cases enable row level security;",
    ),
  );
  assert.ok(
    source.includes(
      "alter table public.care_case_events enable row level security;",
    ),
  );
  assert.ok(
    source.includes(
      "revoke all on table public.care_cases from public, anon, authenticated;",
    ),
  );
  assert.ok(
    source.includes(
      "revoke all on table public.care_case_events from public, anon, authenticated;",
    ),
  );
  assert.ok(
    source.includes(
      "revoke execute on function public.append_care_case_event",
    ),
  );
  assert.ok(source.includes("to service_role;"));
  for (const name of [
    "create_care_case",
    "append_care_case_event",
    "enqueue_care_outbox",
    "claim_care_outbox",
    "complete_care_outbox",
    "fail_care_outbox",
  ]) {
    const start = source.indexOf(
      "create or replace function public." + name,
    );
    assert.ok(start >= 0, name + " must exist");

    const next = source.indexOf(
      "create or replace function public.",
      start + 1,
    );
    const body = source.slice(
      start,
      next >= 0 ? next : source.length,
    );

    assert.ok(
      body.includes("security definer"),
      name + " must run with the migration-owner write boundary",
    );
    assert.ok(
      body.includes("set search_path = pg_catalog"),
      name + " must use a locked search_path",
    );
  }

  assert.ok(
    source.includes(
      "revoke insert, update, delete on table public.care_cases",
    ),
  );
  assert.ok(
    source.includes(
      "revoke insert, update, delete on table public.care_case_events",
    ),
  );
  assert.ok(
    source.includes(
      "revoke insert, update, delete on table public.care_outbox",
    ),
  );
  assert.ok(
    source.includes(
      "grant select on table public.care_cases to service_role",
    ),
  );
  assert.ok(
    source.includes(
      "grant select on table public.care_case_events to service_role",
    ),
  );
  assert.ok(
    source.includes(
      "grant select on table public.care_outbox to service_role",
    ),
  );
  assert.ok(
    source.includes(
      "revoke usage, select on sequence public.care_outbox_id_seq",
    ),
  );
});


test("Signal identity is unique and retry-safe in Postgres", async () => {
  const source = await sql();

  assert.ok(
    source.includes(
      "unique (tenant_id, source_adapter, source_signal_id)",
    ),
  );
  assert.ok(
    source.includes(
      "on conflict (tenant_id, source_adapter, source_signal_id)",
    ),
  );
  assert.ok(source.includes("'created', false"));
  assert.ok(source.includes("'created', true"));
  assert.ok(source.includes("'signal_replay_mismatch'"));
});

test("Case append cannot rewrite immutable Signal lineage", async () => {
  const source = await sql();
  const appendStart = source.indexOf(
    "create or replace function public.append_care_case_event",
  );
  assert.ok(appendStart >= 0);

  const append = source.slice(appendStart);

  assert.ok(
    append.includes(
      "p_snapshot->>'sourceAdapter' is distinct from v_source_adapter",
    ),
  );
  assert.ok(
    append.includes(
      "p_snapshot->>'sourceSignalId' is distinct from v_source_signal_id",
    ),
  );
  assert.ok(
    append.includes(
      "p_snapshot->>'subjectId' is distinct from v_subject_id",
    ),
  );
  assert.ok(
    append.includes("immutable lineage mutation"),
  );

  const updateStart = append.indexOf("update public.care_cases");
  const eventInsert = append.indexOf(
    "insert into public.care_case_events",
  );
  const updateBlock = append.slice(updateStart, eventInsert);

  assert.equal(updateBlock.includes("source_adapter ="), false);
  assert.equal(updateBlock.includes("source_signal_id ="), false);
  assert.equal(updateBlock.includes("subject_id ="), false);
  assert.equal(updateBlock.includes("source_type ="), false);
});


test("Postgres snapshot persists priority changes as operational state", async () => {
  const source = await sql();

  assert.ok(
    source.includes(
      "priority in ('critical', 'high', 'normal', 'low')",
    ),
  );
  assert.ok(source.includes("'priority_changed'"));
  assert.ok(
    source.includes(
      "care_cases_tenant_priority_status_idx",
    ),
  );

  const appendStart = source.indexOf(
    "create or replace function public.append_care_case_event",
  );
  const append = source.slice(appendStart);

  assert.ok(
    append.includes(
      "set priority = p_snapshot->>'priority'",
    ),
  );
});


test("transactional outbox is durable, idempotent, and lease-based", async () => {
  const source = await sql();

  assert.ok(
    source.includes(
      "create table if not exists public.care_outbox",
    ),
  );
  assert.ok(
    source.includes(
      "unique (tenant_id, delivery_key)",
    ),
  );
  assert.ok(
    source.includes(
      "'case.event.committed'",
    ),
  );
  assert.ok(
    source.includes(
      "'case-event:' || v_case_id || ':' || v_event_sequence",
    ),
  );
  assert.ok(
    source.includes(
      "'case-event:' || p_case_id || ':' || v_event_sequence",
    ),
  );
  assert.ok(
    source.includes(
      "for update skip locked",
    ),
  );
  assert.ok(
    source.includes(
      "status = 'dead_letter'",
    ),
  );
  assert.ok(
    source.includes(
      "'delivery_key_reuse'",
    ),
  );
});

test("outbox RPC access is server-only", async () => {
  const source = await sql();

  assert.ok(
    source.includes(
      "revoke all on table public.care_outbox from public, anon, authenticated",
    ),
  );
  assert.ok(
    source.includes(
      "revoke execute on function public.claim_care_outbox",
    ),
  );
  assert.ok(
    source.includes(
      "grant execute on function public.claim_care_outbox",
    ),
  );
  assert.ok(
    source.includes(
      "revoke insert, update, delete on table public.care_outbox",
    ),
  );
  assert.ok(
    source.includes(
      "grant select on table public.care_outbox to service_role",
    ),
  );
});


test("PLpgSQL function delimiters remain balanced", async () => {
  const source = await sql();

  assert.equal(
    source.match(/\nas \$\n/g)?.length ?? 0,
    0,
    "single-dollar function openers are invalid",
  );
  assert.equal(
    source.match(/\nas \$\$\n/g)?.length ?? 0,
    7,
    "all seven persistence RPCs must open with double-dollar delimiters",
  );
  assert.equal(
    source.match(/\n\$;\n/g)?.length ?? 0,
    0,
    "single-dollar function terminators are invalid",
  );
  assert.equal(
    source.match(/\n\$\$;\n/g)?.length ?? 0,
    7,
    "all seven persistence RPCs must close with double-dollar delimiters",
  );
});


test("outbox health projection is payload-free and server-only", async () => {
  const source = await sql();

  const start = source.indexOf(
    "create or replace function public.get_care_outbox_health",
  );
  assert.ok(start >= 0);

  const next = source.indexOf(
    "create or replace function public.",
    start + 1,
  );
  const body = source.slice(
    start,
    next >= 0 ? next : source.length,
  );

  assert.ok(
    body.includes("security invoker"),
    "read-only health RPC must use caller privileges",
  );
  assert.ok(
    body.includes("set search_path = pg_catalog"),
  );
  assert.ok(
    body.includes("'deadLetter'"),
  );
  assert.ok(
    body.includes("'oldestActionableAt'"),
  );
  assert.ok(
    body.includes("'maxAttemptCount'"),
  );

  for (const forbidden of [
    "payload",
    "delivery_key",
    "last_error",
    "case_id",
    "subject_id",
  ]) {
    assert.equal(
      body.includes(forbidden),
      false,
      `${forbidden} must not be returned by the health projection`,
    );
  }

  assert.ok(
    source.includes(
      "revoke execute on function public.get_care_outbox_health(text, boolean)",
    ),
  );
  assert.ok(
    source.includes(
      "grant execute on function public.get_care_outbox_health(text, boolean)",
    ),
  );
});
