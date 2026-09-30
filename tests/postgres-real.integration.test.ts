import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

import {
  createCase,
  executeCommand,
  replayCase,
} from "../src/index.ts";

const databaseUrl = process.env.DATABASE_URL;

function runPsql(args: string[]): string {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  return execFileSync(
    "psql",
    [
      databaseUrl,
      "-X",
      "-qAt",
      "-v",
      "ON_ERROR_STOP=1",
      ...args,
    ],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  ).trim();
}

function sql(query: string): string {
  return runPsql(["-c", query]);
}

function applyFile(path: string): void {
  runPsql(["-f", path]);
}

function jsonLiteral(value: unknown): string {
  const json = JSON.stringify(value).replaceAll("'", "''");
  return "'" + json + "'::jsonb";
}

function textLiteral(value: string): string {
  return "'" + value.replaceAll("'", "''") + "'";
}

test(
  "real Postgres RPC preserves idempotency, conflicts, atomicity and replay",
  { skip: !databaseUrl },
  () => {
    applyFile("tests/postgres/bootstrap.sql");
    applyFile("db/case_store.sql");

    sql(
      "truncate table public.care_outbox, public.care_case_events, " +
      "public.care_cases restart identity cascade;",
    );

    const created = createCase({
      sourceEvidence: { provider: "assemblyai", transcriptId: "signal-db-001", text: " 高熱を出して倒れています。\n", language: "ja", capturedAt: "2026-09-25T06:00:00.000Z", provenance: "client_relayed_session_bound" },
      id: "case-db-001",
      tenantId: "provider-db",
      sourceAdapter: "integration-test",
      sourceSignalId: "signal-db-001",
      subjectId: "subject-db-001",
      sourceType: "non_response",
      priority: "normal",
      createdAt: "2026-09-25T06:00:00.000Z",
    });

    const createResult = JSON.parse(
      sql(
        "set role service_role; select public.create_care_case(" +
        jsonLiteral(created.aggregate) + "," +
        jsonLiteral(created.event) +
        ")::text;",
      ),
    );

    const storedEvidence = JSON.parse(sql("select event#>'{data,sourceEvidence}' from public.care_case_events where tenant_id='provider-db' and case_id='case-db-001' and sequence=1;"));
    assert.deepEqual(storedEvidence, created.event.data.sourceEvidence);

    assert.equal(createResult.ok, true);
    assert.equal(createResult.created, true);
    assert.equal(createResult.caseId, "case-db-001");

    const retry = createCase({
      id: "case-db-retry-proposal",
      tenantId: "provider-db",
      sourceAdapter: "integration-test",
      sourceSignalId: "signal-db-001",
      subjectId: "subject-db-001",
      sourceType: "non_response",
      priority: "normal",
      createdAt: "2026-09-25T06:01:00.000Z",
    });

    const retryResult = JSON.parse(
      sql(
        "set role service_role; select public.create_care_case(" +
        jsonLiteral(retry.aggregate) + "," +
        jsonLiteral(retry.event) +
        ")::text;",
      ),
    );

    assert.equal(retryResult.ok, true);
    assert.equal(retryResult.created, false);
    assert.equal(retryResult.caseId, "case-db-001");

    const countsAfterRetry = JSON.parse(
      sql(
        "select json_build_object(" +
        "'cases',(select count(*) from public.care_cases " +
        "where tenant_id='provider-db')," +
        "'events',(select count(*) from public.care_case_events " +
        "where tenant_id='provider-db')," +
        "'outbox',(select count(*) from public.care_outbox " +
        "where tenant_id='provider-db'))::text;",
      ),
    );

    assert.deepEqual(countsAfterRetry, {
      cases: 1,
      events: 1,
      outbox: 1,
    });

    const acknowledged = executeCommand(
      created.aggregate,
      1,
      {
        type: "acknowledge",
        actorId: "dispatcher-db",
      },
      "2026-09-25T06:02:00.000Z",
    );

    const appendResult = JSON.parse(
      sql(
        "set role service_role; select public.append_care_case_event(" +
        textLiteral("provider-db") + "," +
        textLiteral("case-db-001") + ",1," +
        jsonLiteral(acknowledged.aggregate) + "," +
        jsonLiteral(acknowledged.event) +
        ")::text;",
      ),
    );

    assert.deepEqual(appendResult, {
      ok: true,
      version: 2,
    });

    const stale = executeCommand(
      created.aggregate,
      1,
      {
        type: "acknowledge",
        actorId: "dispatcher-stale",
      },
      "2026-09-25T06:03:00.000Z",
    );

    const staleResult = JSON.parse(
      sql(
        "set role service_role; select public.append_care_case_event(" +
        textLiteral("provider-db") + "," +
        textLiteral("case-db-001") + ",1," +
        jsonLiteral(stale.aggregate) + "," +
        jsonLiteral(stale.event) +
        ")::text;",
      ),
    );

    assert.equal(staleResult.ok, false);
    assert.equal(staleResult.conflict, true);
    assert.equal(staleResult.currentVersion, 2);

    const assigned = executeCommand(
      acknowledged.aggregate,
      2,
      {
        type: "assign",
        actorId: "dispatcher-db",
        assigneeId: "responder-db",
      },
      "2026-09-25T06:04:00.000Z",
    );

    const invalidEvent = {
      ...assigned.event,
      type: "not_a_real_event",
    };

    assert.throws(() =>
      sql(
        "set role service_role; select public.append_care_case_event(" +
        textLiteral("provider-db") + "," +
        textLiteral("case-db-001") + ",2," +
        jsonLiteral(assigned.aggregate) + "," +
        jsonLiteral(invalidEvent) +
        ")::text;",
      ),
    );

    const afterFailedTransaction = JSON.parse(
      sql(
        "select json_build_object(" +
        "'version',version,'status',status," +
        "'events',(select count(*) from public.care_case_events e " +
        "where e.tenant_id=c.tenant_id and e.case_id=c.case_id)," +
        "'outbox',(select count(*) from public.care_outbox o " +
        "where o.tenant_id=c.tenant_id)" +
        ")::text from public.care_cases c " +
        "where tenant_id='provider-db' and case_id='case-db-001';",
      ),
    );

    assert.deepEqual(afterFailedTransaction, {
      version: 2,
      status: "ACKNOWLEDGED",
      events: 2,
      outbox: 2,
    });

    const stored = JSON.parse(
      sql(
        "select json_build_object(" +
        "'snapshot',c.snapshot," +
        "'events',(select coalesce(json_agg(e.event order by e.sequence)," +
        "'[]'::json) from public.care_case_events e " +
        "where e.tenant_id=c.tenant_id and e.case_id=c.case_id)" +
        ")::text from public.care_cases c " +
        "where c.tenant_id='provider-db' and c.case_id='case-db-001';",
      ),
    );

    assert.deepEqual(
      replayCase(stored.events),
      stored.snapshot,
    );

    const initialOutboxKeys = JSON.parse(
      sql(
        "select coalesce(json_agg(delivery_key order by id),'[]'::json)::text " +
        "from public.care_outbox where tenant_id='provider-db';",
      ),
    );
    assert.deepEqual(initialOutboxKeys, [
      "case-event:case-db-001:1",
      "case-event:case-db-001:2",
    ]);

    const firstClaim = JSON.parse(
      sql(
        "set role service_role; select public.claim_care_outbox(" +
        "'provider-db','worker-a',1,60)::text;",
      ),
    );
    assert.equal(firstClaim.length, 1);
    assert.equal(firstClaim[0].attemptCount, 1);
    assert.equal(firstClaim[0].workerId, "worker-a");

    const secondClaim = JSON.parse(
      sql(
        "set role service_role; select public.claim_care_outbox(" +
        "'provider-db','worker-b',10,60)::text;",
      ),
    );
    assert.equal(secondClaim.length, 1);
    assert.notEqual(secondClaim[0].id, firstClaim[0].id);

    const completeFirst = JSON.parse(
      sql(
        "set role service_role; select public.complete_care_outbox(" +
        "'provider-db'," + firstClaim[0].id + ",'worker-a')::text;",
      ),
    );
    assert.equal(completeFirst.ok, true);

    const failSecond = JSON.parse(
      sql(
        "set role service_role; select public.fail_care_outbox(" +
        "'provider-db'," + secondClaim[0].id +
        ",'worker-b','synthetic failure',now())::text;",
      ),
    );
    assert.equal(failSecond.ok, true);
    assert.equal(failSecond.status, "failed");

    const retryClaim = JSON.parse(
      sql(
        "set role service_role; select public.claim_care_outbox(" +
        "'provider-db','worker-c',1,60)::text;",
      ),
    );
    assert.equal(retryClaim.length, 1);
    assert.equal(retryClaim[0].id, secondClaim[0].id);
    assert.equal(retryClaim[0].attemptCount, 2);

    const completeRetry = JSON.parse(
      sql(
        "set role service_role; select public.complete_care_outbox(" +
        "'provider-db'," + retryClaim[0].id + ",'worker-c')::text;",
      ),
    );
    assert.equal(completeRetry.ok, true);

    const escalationPayload = {
      caseId: "case-db-001",
      stage: "acknowledge",
      dueAt: "2026-09-25T06:01:00.000Z",
    };

    const enqueueFirst = JSON.parse(
      sql(
        "set role service_role; select public.enqueue_care_outbox(" +
        "'provider-db','sla.breach','sla:case-db-001:ack'," +
        jsonLiteral(escalationPayload) + ",now(),1)::text;",
      ),
    );
    assert.equal(enqueueFirst.ok, true);
    assert.equal(enqueueFirst.created, true);

    const enqueueRetry = JSON.parse(
      sql(
        "set role service_role; select public.enqueue_care_outbox(" +
        "'provider-db','sla.breach','sla:case-db-001:ack'," +
        jsonLiteral(escalationPayload) + ",now(),1)::text;",
      ),
    );
    assert.equal(enqueueRetry.ok, true);
    assert.equal(enqueueRetry.created, false);
    assert.equal(enqueueRetry.id, enqueueFirst.id);

    const enqueueConflict = JSON.parse(
      sql(
        "set role service_role; select public.enqueue_care_outbox(" +
        "'provider-db','sla.breach','sla:case-db-001:ack'," +
        jsonLiteral({
          ...escalationPayload,
          stage: "assign",
        }) + ",now(),1)::text;",
      ),
    );
    assert.equal(enqueueConflict.ok, false);
    assert.equal(enqueueConflict.conflict, true);
    assert.equal(
      enqueueConflict.reason,
      "delivery_key_reuse",
    );

    const deadLetterClaim = JSON.parse(
      sql(
        "set role service_role; select public.claim_care_outbox(" +
        "'provider-db','worker-d',10,60)::text;",
      ),
    );
    assert.equal(deadLetterClaim.length, 1);
    assert.equal(deadLetterClaim[0].id, enqueueFirst.id);

    const deadLetterResult = JSON.parse(
      sql(
        "set role service_role; select public.fail_care_outbox(" +
        "'provider-db'," + enqueueFirst.id +
        ",'worker-d','permanent synthetic failure',now())::text;",
      ),
    );
    assert.equal(deadLetterResult.ok, true);
    assert.equal(deadLetterResult.status, "dead_letter");

    const outboxHealth = JSON.parse(
      sql(
        "set role service_role; select public.get_care_outbox_health(" +
        "'provider-db',false)::text;",
      ),
    );

    assert.equal(
      outboxHealth.tenantId,
      "provider-db",
    );
    assert.deepEqual(
      outboxHealth.counts,
      {
        pending: 0,
        processing: 0,
        failed: 0,
        deadLetter: 1,
        delivered: null,
      },
    );
    assert.equal(
      outboxHealth.oldestActionableAt,
      null,
    );
    assert.equal(
      typeof outboxHealth.oldestDeadLetterAt,
      "string",
    );
    assert.equal(
      outboxHealth.maxAttemptCount,
      2,
    );

    const outboxHealthWithDelivered =
      JSON.parse(
        sql(
          "set role service_role; select public.get_care_outbox_health(" +
          "'provider-db',true)::text;",
        ),
      );

    assert.equal(
      outboxHealthWithDelivered.counts
        .delivered,
      2,
    );

    const healthSerialized =
      JSON.stringify(
        outboxHealthWithDelivered,
      );

    for (const forbidden of [
      "payload",
      "deliveryKey",
      "lastError",
      "caseId",
      "subjectId",
      "permanent synthetic failure",
    ]) {
      assert.equal(
        healthSerialized.includes(
          forbidden,
        ),
        false,
      );
    }

    const privileges = JSON.parse(
      sql(
        "select json_build_object(" +
        "'case_select',has_table_privilege(" +
        "'service_role','public.care_cases','SELECT')," +
        "'case_insert',has_table_privilege(" +
        "'service_role','public.care_cases','INSERT')," +
        "'case_update',has_table_privilege(" +
        "'service_role','public.care_cases','UPDATE')," +
        "'event_select',has_table_privilege(" +
        "'service_role','public.care_case_events','SELECT')," +
        "'event_insert',has_table_privilege(" +
        "'service_role','public.care_case_events','INSERT')," +
        "'event_update',has_table_privilege(" +
        "'service_role','public.care_case_events','UPDATE')," +
        "'outbox_select',has_table_privilege(" +
        "'service_role','public.care_outbox','SELECT')," +
        "'outbox_insert',has_table_privilege(" +
        "'service_role','public.care_outbox','INSERT')," +
        "'outbox_update',has_table_privilege(" +
        "'service_role','public.care_outbox','UPDATE')," +
        "'sequence_usage',has_sequence_privilege(" +
        "'service_role','public.care_outbox_id_seq','USAGE')" +
        ")::text;",
      ),
    );

    assert.deepEqual(privileges, {
      case_select: true,
      case_insert: false,
      case_update: false,
      event_select: true,
      event_insert: false,
      event_update: false,
      outbox_select: true,
      outbox_insert: false,
      outbox_update: false,
      sequence_usage: false,
    });

    assert.throws(() =>
      sql(
        "set role service_role; " +
        "update public.care_cases set status='CLOSED' " +
        "where tenant_id='provider-db' and case_id='case-db-001';",
      ),
    );

    assert.throws(() =>
      sql(
        "set role service_role; " +
        "insert into public.care_case_events " +
        "(tenant_id,case_id,sequence,event_type,actor_id,occurred_at,data,event) " +
        "values ('provider-db','case-db-001',999,'closed','forged',now()," +
        "'{}'::jsonb,'{}'::jsonb);",
      ),
    );

    assert.throws(() =>
      sql(
        "set role service_role; " +
        "update public.care_outbox set status='delivered' " +
        "where tenant_id='provider-db';",
      ),
    );
  },
);
