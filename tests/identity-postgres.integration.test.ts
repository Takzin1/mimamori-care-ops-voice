import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

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

function admin(query: string): string {
  return sql(
    "set role care_membership_admin; " +
      query +
      "; reset role;",
  );
}

test(
  "real Postgres membership store separates runtime read access from audited admin mutation",
  { skip: !databaseUrl },
  () => {
    applyFile("tests/postgres/bootstrap.sql");
    applyFile("db/identity_store.sql");

    sql(
      "truncate table " +
        "public.care_membership_admin_events, " +
        "public.care_tenant_memberships;",
    );

    const created = JSON.parse(
      admin(
        "select care_admin.create_membership(" +
          "'provider-a'," +
          "'principal-a'," +
          "'responder-a'," +
          "array['responder']::text[]," +
          "true," +
          "'admin-root'," +
          "'initial staff provisioning'," +
          "'2026-09-26T01:00:00.000Z'::timestamptz" +
          ")::text",
      ),
    );

    assert.equal(created.ok, true);
    assert.equal(created.membership.version, 1);
    assert.equal(
      created.membership.actor_id,
      "responder-a",
    );

    const row = JSON.parse(
      sql(
        "set role service_role; " +
          "select row_to_json(m)::text from (" +
          "select tenant_id,principal_id,actor_id,roles,active,version " +
          "from public.care_tenant_memberships " +
          "where tenant_id='provider-a' and principal_id='principal-a'" +
          ") m; reset role;",
      ),
    );

    assert.deepEqual(row, {
      tenant_id: "provider-a",
      principal_id: "principal-a",
      actor_id: "responder-a",
      roles: ["responder"],
      active: true,
      version: 1,
    });

    const firstEvent = JSON.parse(
      sql(
        "set role service_role; " +
          "select row_to_json(e)::text from (" +
          "select version,event_type,admin_actor_id,reason,data " +
          "from public.care_membership_admin_events " +
          "where tenant_id='provider-a' and principal_id='principal-a'" +
          ") e; reset role;",
      ),
    );

    assert.equal(
      firstEvent.event_type,
      "membership_created",
    );
    assert.equal(
      firstEvent.admin_actor_id,
      "admin-root",
    );
    assert.equal(
      firstEvent.reason,
      "initial staff provisioning",
    );
    assert.deepEqual(
      firstEvent.data.roles,
      ["responder"],
    );

    const privileges = JSON.parse(
      sql(
        "select json_build_object(" +
          "'anon_select',has_table_privilege(" +
          "'anon','public.care_tenant_memberships','SELECT')," +
          "'authenticated_select',has_table_privilege(" +
          "'authenticated','public.care_tenant_memberships','SELECT')," +
          "'service_select',has_table_privilege(" +
          "'service_role','public.care_tenant_memberships','SELECT')," +
          "'service_insert',has_table_privilege(" +
          "'service_role','public.care_tenant_memberships','INSERT')," +
          "'service_update',has_table_privilege(" +
          "'service_role','public.care_tenant_memberships','UPDATE')," +
          "'service_delete',has_table_privilege(" +
          "'service_role','public.care_tenant_memberships','DELETE')," +
          "'admin_insert',has_table_privilege(" +
          "'care_membership_admin','public.care_tenant_memberships','INSERT')," +
          "'admin_update',has_table_privilege(" +
          "'care_membership_admin','public.care_tenant_memberships','UPDATE')," +
          "'admin_delete',has_table_privilege(" +
          "'care_membership_admin','public.care_tenant_memberships','DELETE')," +
          "'admin_audit_insert',has_table_privilege(" +
          "'care_membership_admin','public.care_membership_admin_events','INSERT')" +
          ")::text;",
      ),
    );

    assert.deepEqual(privileges, {
      anon_select: false,
      authenticated_select: false,
      service_select: true,
      service_insert: false,
      service_update: false,
      service_delete: false,
      admin_insert: true,
      admin_update: true,
      admin_delete: false,
      admin_audit_insert: false,
    });

    assert.throws(() =>
      sql(
        "set role service_role; " +
          "update public.care_tenant_memberships " +
          "set active=false " +
          "where tenant_id='provider-a' and principal_id='principal-a';",
      ),
    );

    assert.throws(() =>
      admin(
        "update public.care_tenant_memberships " +
          "set active=false,version=version+1 " +
          "where tenant_id='provider-a' and principal_id='principal-a'",
      ),
    );

    const rolesChanged = JSON.parse(
      admin(
        "select care_admin.transition_membership(" +
          "'provider-a'," +
          "'principal-a'," +
          "1," +
          "'replace_roles'," +
          "array['dispatcher','responder']::text[]," +
          "null," +
          "'admin-root'," +
          "'dispatcher duty added'," +
          "'2026-09-26T01:05:00.000Z'::timestamptz" +
          ")::text",
      ),
    );

    assert.equal(rolesChanged.ok, true);
    assert.equal(
      rolesChanged.membership.version,
      2,
    );
    assert.deepEqual(
      rolesChanged.membership.roles,
      ["dispatcher", "responder"],
    );

    const stale = JSON.parse(
      admin(
        "select care_admin.transition_membership(" +
          "'provider-a'," +
          "'principal-a'," +
          "1," +
          "'deactivate'," +
          "null," +
          "null," +
          "'admin-root'," +
          "'stale attempt'," +
          "'2026-09-26T01:06:00.000Z'::timestamptz" +
          ")::text",
      ),
    );

    assert.deepEqual(stale, {
      ok: false,
      conflict: true,
      currentVersion: 2,
    });

    const deactivated = JSON.parse(
      admin(
        "select care_admin.transition_membership(" +
          "'provider-a'," +
          "'principal-a'," +
          "2," +
          "'deactivate'," +
          "null," +
          "null," +
          "'admin-root'," +
          "'staff transfer'," +
          "'2026-09-26T01:10:00.000Z'::timestamptz" +
          ")::text",
      ),
    );

    assert.equal(deactivated.ok, true);
    assert.equal(
      deactivated.membership.version,
      3,
    );
    assert.equal(
      deactivated.membership.active,
      false,
    );

    const audit = JSON.parse(
      sql(
        "select json_agg(x order by version)::text from (" +
          "select version,event_type,admin_actor_id,reason " +
          "from public.care_membership_admin_events " +
          "where tenant_id='provider-a' and principal_id='principal-a'" +
          ") x;",
      ),
    );

    assert.deepEqual(
      audit.map(
        (event: { version: number; event_type: string }) => [
          event.version,
          event.event_type,
        ],
      ),
      [
        [1, "membership_created"],
        [2, "roles_replaced"],
        [3, "membership_deactivated"],
      ],
    );

    sql(
      "insert into public.care_membership_admin_events (" +
        "tenant_id,principal_id,version,event_type," +
        "admin_actor_id,reason,event_at,data" +
        ") values (" +
        "'provider-a','principal-a',4,'membership_activated'," +
        "'test-fixture','forced audit conflict'," +
        "'2026-09-26T01:11:00.000Z','{}'::jsonb" +
        ");",
    );

    assert.throws(() =>
      admin(
        "select care_admin.transition_membership(" +
          "'provider-a'," +
          "'principal-a'," +
          "3," +
          "'activate'," +
          "null," +
          "null," +
          "'admin-root'," +
          "'should roll back'," +
          "'2026-09-26T01:12:00.000Z'::timestamptz" +
          ")::text",
      ),
    );

    const afterFailedAudit = JSON.parse(
      sql(
        "select json_build_object(" +
          "'version',version," +
          "'active',active" +
          ")::text " +
          "from public.care_tenant_memberships " +
          "where tenant_id='provider-a' and principal_id='principal-a';",
      ),
    );

    assert.deepEqual(afterFailedAudit, {
      version: 3,
      active: false,
    });

    sql(
      "delete from public.care_membership_admin_events " +
        "where tenant_id='provider-a' " +
        "and principal_id='principal-a' " +
        "and version=4;",
    );

    assert.throws(() =>
      admin(
        "select care_admin.create_membership(" +
          "'provider-a'," +
          "'principal-b'," +
          "'actor-b'," +
          "array['root']::text[]," +
          "true," +
          "'admin-root'," +
          "'invalid role attempt'," +
          "'2026-09-26T01:20:00.000Z'::timestamptz" +
          ")::text",
      ),
    );

    assert.throws(() =>
      admin(
        "select care_admin.create_membership(" +
          "'provider-a'," +
          "'principal-unsafe'," +
          "'responder-a,or(actor_id.eq.attacker)'," +
          "array['responder']::text[]," +
          "true," +
          "'admin-root'," +
          "'unsafe actor filter syntax'," +
          "'2026-09-26T01:20:30.000Z'::timestamptz" +
          ")::text",
      ),
    );

    const duplicateActor = JSON.parse(
      admin(
        "select care_admin.create_membership(" +
          "'provider-a'," +
          "'principal-c'," +
          "'responder-a'," +
          "array['responder']::text[]," +
          "true," +
          "'admin-root'," +
          "'duplicate actor attempt'," +
          "'2026-09-26T01:21:00.000Z'::timestamptz" +
          ")::text",
      ),
    );

    assert.deepEqual(duplicateActor, {
      ok: false,
      alreadyExists: true,
    });

    const otherTenant = JSON.parse(
      admin(
        "select care_admin.create_membership(" +
          "'provider-b'," +
          "'principal-a'," +
          "'responder-a'," +
          "array['auditor']::text[]," +
          "false," +
          "'admin-root'," +
          "'separate tenant membership'," +
          "'2026-09-26T01:22:00.000Z'::timestamptz" +
          ")::text",
      ),
    );

    assert.equal(otherTenant.ok, true);

    const count = Number(
      sql(
        "select count(*) from public.care_tenant_memberships " +
          "where principal_id='principal-a';",
      ),
    );
    assert.equal(count, 2);
  },
);
