import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function sql(): Promise<string> {
  return readFile(
    new URL("../db/identity_store.sql", import.meta.url),
    "utf8",
  );
}

test("membership store uses tenant-scoped principal and actor identities", async () => {
  const source = await sql();

  assert.ok(
    source.includes(
      "primary key (tenant_id, principal_id)",
    ),
  );
  assert.ok(
    source.includes(
      "unique (tenant_id, actor_id)",
    ),
  );
  assert.ok(
    source.includes(
      "'dispatcher'",
    ),
  );
  assert.ok(source.includes("'responder'"));
  assert.ok(source.includes("'supervisor'"));
  assert.ok(source.includes("'auditor'"));
});

test("membership store is fail-closed to server-side lookup only", async () => {
  const source = await sql();

  assert.ok(
    source.includes(
      "alter table public.care_tenant_memberships",
    ),
  );
  assert.ok(
    source.includes(
      "enable row level security",
    ),
  );
  assert.ok(
    source.includes(
      "revoke all on table public.care_tenant_memberships",
    ),
  );
  assert.ok(
    source.includes(
      "from public, anon, authenticated",
    ),
  );
  assert.ok(
    source.includes(
      "revoke insert, update, delete",
    ),
  );
  assert.ok(
    source.includes(
      "on table public.care_tenant_memberships",
    ),
  );
  assert.ok(
    source.includes(
      "grant select",
    ),
  );
  assert.ok(source.includes("to service_role"));
});


test("membership administration remains separate from runtime credentials", async () => {
  const source = await sql();

  assert.ok(
    source.includes(
      "create role care_membership_admin",
    ),
  );
  assert.ok(
    source.includes(
      "revoke insert, update, delete\n  on table public.care_tenant_memberships\n  from service_role",
    ),
  );
  assert.ok(
    source.includes(
      "grant select, insert, update\n  on table public.care_tenant_memberships\n  to care_membership_admin",
    ),
  );
  assert.ok(
    source.includes(
      "revoke all on table public.care_membership_admin_events\n  from care_membership_admin",
    ),
  );
  assert.ok(
    source.includes(
      "grant select\n  on table public.care_membership_admin_events\n  to care_membership_admin",
    ),
  );
});

test("membership mutation contract is versioned and append-only audited", async () => {
  const source = await sql();

  assert.ok(
    source.includes(
      "version bigint not null default 1",
    ),
  );
  assert.ok(
    source.includes(
      "create table if not exists public.care_membership_admin_events",
    ),
  );
  assert.ok(
    source.includes(
      "primary key (\n    tenant_id,\n    principal_id,\n    version\n  )",
    ),
  );
  assert.ok(
    source.includes(
      "membership deletion is forbidden; deactivate instead",
    ),
  );
  assert.ok(
    source.includes(
      "membership version must increment by exactly one",
    ),
  );
  assert.ok(
    source.includes(
      "exactly one membership field may change per version",
    ),
  );
  assert.ok(
    source.includes(
      "care_membership_audit_mutation",
    ),
  );
  assert.ok(
    source.includes(
      "care_admin.create_membership",
    ),
  );
  assert.ok(
    source.includes(
      "care_admin.transition_membership",
    ),
  );
  assert.ok(
    source.includes(
      "security invoker",
    ),
  );
});


test("identity PLpgSQL function delimiters remain balanced", async () => {
  const source = await sql();

  const openers =
    (source.match(/(?:do|as) \$\$/g) ?? []).length;
  const closers =
    (source.match(/\n\$\$;\n/g) ?? []).length;
  const brokenClosers =
    (source.match(/\n\$;\n/g) ?? []).length;

  assert.ok(openers >= 7);
  assert.equal(closers, openers);
  assert.equal(brokenClosers, 0);
});


test("actor ID grammar is enforced in the membership store", async () => {
  const source = await sql();

  assert.ok(
    source.includes(
      "care_tenant_memberships_actor_id_format_check",
    ),
  );
  assert.ok(
    source.includes(
      "actor_id ~ '^[A-Za-z0-9._:-]{1,128}$'",
    ),
  );
});
