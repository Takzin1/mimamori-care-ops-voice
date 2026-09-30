-- Mimamori Care Ops — production identity / membership store
-- Reference schema. Apply only to an intentionally provisioned project.
--
-- Runtime and control-plane credentials are deliberately separated:
--   service_role          -> membership/audit SELECT only
--   care_membership_admin -> audited INSERT/UPDATE only
--
-- care_membership_admin is NOLOGIN. A trusted administrative database
-- connection may SET ROLE to it. It is never granted to the runtime
-- service_role and is not a browser/Data API credential.

do $$
begin
  if not exists (
    select 1 from pg_roles
    where rolname = 'care_membership_admin'
  ) then
    create role care_membership_admin
      nologin
      noinherit;
  end if;
end;
$$;

create table if not exists public.care_tenant_memberships (
  tenant_id text not null,
  principal_id text not null,
  actor_id text not null,
  roles text[] not null check (
    cardinality(roles) >= 1
    and roles <@ array[
      'dispatcher',
      'responder',
      'supervisor',
      'auditor'
    ]::text[]
  ),
  active boolean not null default true,
  version bigint not null default 1
    check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, principal_id),
  unique (tenant_id, actor_id)
);

alter table public.care_tenant_memberships
  add column if not exists version bigint
  not null default 1;

create index if not exists care_memberships_tenant_active_idx
  on public.care_tenant_memberships (
    tenant_id,
    active,
    actor_id
  );

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname =
      'care_tenant_memberships_actor_id_format_check'
      and conrelid =
        'public.care_tenant_memberships'::regclass
  ) then
    alter table public.care_tenant_memberships
      add constraint
        care_tenant_memberships_actor_id_format_check
      check (
        actor_id ~ '^[A-Za-z0-9._:-]{1,128}$'
      );
  end if;
end;
$$;

create table if not exists public.care_membership_admin_events (
  tenant_id text not null,
  principal_id text not null,
  version bigint not null check (version >= 1),
  event_type text not null check (
    event_type in (
      'membership_created',
      'roles_replaced',
      'membership_activated',
      'membership_deactivated',
      'actor_id_changed'
    )
  ),
  admin_actor_id text not null
    check (length(btrim(admin_actor_id)) > 0),
  reason text not null
    check (length(btrim(reason)) > 0),
  event_at timestamptz not null,
  data jsonb not null default '{}'::jsonb,
  primary key (
    tenant_id,
    principal_id,
    version
  ),
  foreign key (
    tenant_id,
    principal_id
  )
    references public.care_tenant_memberships (
      tenant_id,
      principal_id
    )
    on update restrict
    on delete restrict
);

create index if not exists care_membership_admin_events_actor_idx
  on public.care_membership_admin_events (
    tenant_id,
    admin_actor_id,
    event_at desc
  );

alter table public.care_tenant_memberships
  enable row level security;

alter table public.care_membership_admin_events
  enable row level security;


drop policy if exists
  care_membership_admin_select_memberships
  on public.care_tenant_memberships;

create policy care_membership_admin_select_memberships
  on public.care_tenant_memberships
  for select
  to care_membership_admin
  using (true);

drop policy if exists
  care_membership_admin_insert_memberships
  on public.care_tenant_memberships;

create policy care_membership_admin_insert_memberships
  on public.care_tenant_memberships
  for insert
  to care_membership_admin
  with check (true);

drop policy if exists
  care_membership_admin_update_memberships
  on public.care_tenant_memberships;

create policy care_membership_admin_update_memberships
  on public.care_tenant_memberships
  for update
  to care_membership_admin
  using (true)
  with check (true);

drop policy if exists
  care_membership_admin_select_events
  on public.care_membership_admin_events;

create policy care_membership_admin_select_events
  on public.care_membership_admin_events
  for select
  to care_membership_admin
  using (true);

revoke all on table public.care_tenant_memberships
  from public, anon, authenticated;

revoke all on table public.care_membership_admin_events
  from public, anon, authenticated;

revoke insert, update, delete
  on table public.care_tenant_memberships
  from service_role;

revoke insert, update, delete
  on table public.care_membership_admin_events
  from service_role;

grant select on table public.care_tenant_memberships
  to service_role;

grant select on table public.care_membership_admin_events
  to service_role;

revoke all on table public.care_tenant_memberships
  from care_membership_admin;

revoke all on table public.care_membership_admin_events
  from care_membership_admin;

grant select, insert, update
  on table public.care_tenant_memberships
  to care_membership_admin;

grant select
  on table public.care_membership_admin_events
  to care_membership_admin;

create schema if not exists care_admin;
revoke all on schema care_admin from public;
grant usage on schema care_admin
  to care_membership_admin;

create or replace function care_admin.membership_context_text(
  p_name text
)
returns text
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_value text;
begin
  v_value := nullif(
    btrim(current_setting(p_name, true)),
    ''
  );

  if v_value is null then
    raise exception
      'membership admin context % is required',
      p_name
      using errcode = '22023';
  end if;

  return v_value;
end;
$$;

create or replace function care_admin.validate_membership_mutation()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_event_at timestamptz;
  v_changes integer := 0;
begin
  perform care_admin.membership_context_text(
    'care.admin_actor_id'
  );
  perform care_admin.membership_context_text(
    'care.change_reason'
  );

  begin
    v_event_at :=
      care_admin.membership_context_text(
        'care.event_at'
      )::timestamptz;
  exception
    when others then
      raise exception
        'care.event_at must be a valid timestamptz'
        using errcode = '22023';
  end;

  if tg_op = 'DELETE' then
    raise exception
      'membership deletion is forbidden; deactivate instead'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if new.version <> 1 then
      raise exception
        'new membership version must be 1'
        using errcode = '22023';
    end if;

    new.created_at := v_event_at;
    new.updated_at := v_event_at;
    return new;
  end if;

  if new.tenant_id is distinct from old.tenant_id
     or new.principal_id is distinct from old.principal_id
     or new.created_at is distinct from old.created_at then
    raise exception
      'membership identity and created_at are immutable'
      using errcode = '22023';
  end if;

  if new.version <> old.version + 1 then
    raise exception
      'membership version must increment by exactly one'
      using errcode = '40001';
  end if;

  if new.actor_id is distinct from old.actor_id then
    v_changes := v_changes + 1;
  end if;

  if new.roles is distinct from old.roles then
    v_changes := v_changes + 1;
  end if;

  if new.active is distinct from old.active then
    v_changes := v_changes + 1;
  end if;

  if v_changes <> 1 then
    raise exception
      'exactly one membership field may change per version'
      using errcode = '22023';
  end if;

  new.updated_at := v_event_at;
  return new;
end;
$$;

create or replace function care_admin.audit_membership_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_admin_actor_id text;
  v_reason text;
  v_event_at timestamptz;
  v_event_type text;
  v_data jsonb;
begin
  v_admin_actor_id :=
    care_admin.membership_context_text(
      'care.admin_actor_id'
    );
  v_reason :=
    care_admin.membership_context_text(
      'care.change_reason'
    );
  v_event_at :=
    care_admin.membership_context_text(
      'care.event_at'
    )::timestamptz;

  if tg_op = 'INSERT' then
    v_event_type := 'membership_created';
    v_data := jsonb_build_object(
      'actorId', new.actor_id,
      'roles', to_jsonb(new.roles),
      'active', new.active
    );
  elsif new.actor_id is distinct from old.actor_id then
    v_event_type := 'actor_id_changed';
    v_data := jsonb_build_object(
      'previousActorId', old.actor_id,
      'actorId', new.actor_id
    );
  elsif new.roles is distinct from old.roles then
    v_event_type := 'roles_replaced';
    v_data := jsonb_build_object(
      'previousRoles', to_jsonb(old.roles),
      'roles', to_jsonb(new.roles)
    );
  elsif new.active = true and old.active = false then
    v_event_type := 'membership_activated';
    v_data := '{}'::jsonb;
  elsif new.active = false and old.active = true then
    v_event_type := 'membership_deactivated';
    v_data := '{}'::jsonb;
  else
    raise exception
      'unsupported membership mutation'
      using errcode = '22023';
  end if;

  insert into public.care_membership_admin_events (
    tenant_id,
    principal_id,
    version,
    event_type,
    admin_actor_id,
    reason,
    event_at,
    data
  )
  values (
    new.tenant_id,
    new.principal_id,
    new.version,
    v_event_type,
    v_admin_actor_id,
    v_reason,
    v_event_at,
    v_data
  );

  return new;
end;
$$;

revoke all on function
  care_admin.membership_context_text(text)
  from public;


grant execute on function
  care_admin.membership_context_text(text)
  to care_membership_admin;

revoke all on function
  care_admin.validate_membership_mutation()
  from public;

revoke all on function
  care_admin.audit_membership_mutation()
  from public;

drop trigger if exists
  care_membership_validate_mutation
  on public.care_tenant_memberships;

create trigger care_membership_validate_mutation
before insert or update or delete
on public.care_tenant_memberships
for each row
execute function care_admin.validate_membership_mutation();

drop trigger if exists
  care_membership_audit_mutation
  on public.care_tenant_memberships;

create trigger care_membership_audit_mutation
after insert or update
on public.care_tenant_memberships
for each row
execute function care_admin.audit_membership_mutation();

create or replace function care_admin.create_membership(
  p_tenant_id text,
  p_principal_id text,
  p_actor_id text,
  p_roles text[],
  p_active boolean,
  p_admin_actor_id text,
  p_reason text,
  p_at timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_row public.care_tenant_memberships;
  v_constraint_name text;
begin
  perform set_config(
    'care.admin_actor_id',
    btrim(p_admin_actor_id),
    true
  );
  perform set_config(
    'care.change_reason',
    btrim(p_reason),
    true
  );
  perform set_config(
    'care.event_at',
    p_at::text,
    true
  );

  insert into public.care_tenant_memberships (
    tenant_id,
    principal_id,
    actor_id,
    roles,
    active,
    version,
    created_at,
    updated_at
  )
  values (
    btrim(p_tenant_id),
    btrim(p_principal_id),
    btrim(p_actor_id),
    p_roles,
    p_active,
    1,
    p_at,
    p_at
  )
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'membership', to_jsonb(v_row)
  );
exception
  when unique_violation then
    get stacked diagnostics
      v_constraint_name = constraint_name;

    if v_constraint_name in (
      'care_tenant_memberships_pkey',
      'care_tenant_memberships_tenant_id_actor_id_key'
    ) then
      return jsonb_build_object(
        'ok', false,
        'alreadyExists', true
      );
    end if;

    raise;
end;
$$;

create or replace function care_admin.transition_membership(
  p_tenant_id text,
  p_principal_id text,
  p_expected_version bigint,
  p_command text,
  p_roles text[],
  p_actor_id text,
  p_admin_actor_id text,
  p_reason text,
  p_at timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_row public.care_tenant_memberships;
  v_current_version bigint;
  v_constraint_name text;
begin
  if p_expected_version < 1 then
    raise exception
      'expected version must be >= 1'
      using errcode = '22023';
  end if;

  if p_command not in (
    'replace_roles',
    'activate',
    'deactivate',
    'change_actor_id'
  ) then
    raise exception
      'unsupported membership command %',
      p_command
      using errcode = '22023';
  end if;

  perform set_config(
    'care.admin_actor_id',
    btrim(p_admin_actor_id),
    true
  );
  perform set_config(
    'care.change_reason',
    btrim(p_reason),
    true
  );
  perform set_config(
    'care.event_at',
    p_at::text,
    true
  );

  if p_command = 'replace_roles' then
    update public.care_tenant_memberships
       set roles = p_roles,
           version = version + 1
     where tenant_id = p_tenant_id
       and principal_id = p_principal_id
       and version = p_expected_version
       and roles is distinct from p_roles
    returning * into v_row;

  elsif p_command = 'activate' then
    update public.care_tenant_memberships
       set active = true,
           version = version + 1
     where tenant_id = p_tenant_id
       and principal_id = p_principal_id
       and version = p_expected_version
       and active = false
    returning * into v_row;

  elsif p_command = 'deactivate' then
    update public.care_tenant_memberships
       set active = false,
           version = version + 1
     where tenant_id = p_tenant_id
       and principal_id = p_principal_id
       and version = p_expected_version
       and active = true
    returning * into v_row;

  elsif p_command = 'change_actor_id' then
    update public.care_tenant_memberships
       set actor_id = btrim(p_actor_id),
           version = version + 1
     where tenant_id = p_tenant_id
       and principal_id = p_principal_id
       and version = p_expected_version
       and actor_id is distinct from btrim(p_actor_id)
    returning * into v_row;
  end if;

  if found then
    return jsonb_build_object(
      'ok', true,
      'membership', to_jsonb(v_row)
    );
  end if;

  select version
    into v_current_version
    from public.care_tenant_memberships
   where tenant_id = p_tenant_id
     and principal_id = p_principal_id;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'notFound', true
    );
  end if;

  if v_current_version <> p_expected_version then
    return jsonb_build_object(
      'ok', false,
      'conflict', true,
      'currentVersion', v_current_version
    );
  end if;

  return jsonb_build_object(
    'ok', false,
    'invalidTransition', true,
    'currentVersion', v_current_version
  );
exception
  when unique_violation then
    get stacked diagnostics
      v_constraint_name = constraint_name;

    if v_constraint_name =
      'care_tenant_memberships_tenant_id_actor_id_key'
    then
      return jsonb_build_object(
        'ok', false,
        'alreadyExists', true
      );
    end if;

    raise;
end;
$$;

revoke all on function care_admin.create_membership(
  text,
  text,
  text,
  text[],
  boolean,
  text,
  text,
  timestamptz
) from public, anon, authenticated, service_role;

revoke all on function care_admin.transition_membership(
  text,
  text,
  bigint,
  text,
  text[],
  text,
  text,
  text,
  timestamptz
) from public, anon, authenticated, service_role;

grant execute on function care_admin.create_membership(
  text,
  text,
  text,
  text[],
  boolean,
  text,
  text,
  timestamptz
) to care_membership_admin;

grant execute on function care_admin.transition_membership(
  text,
  text,
  bigint,
  text,
  text[],
  text,
  text,
  text,
  timestamptz
) to care_membership_admin;
