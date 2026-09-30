-- Mimamori Care Ops — Postgres persistence contract
-- Reference schema for the GK / Last-mile Case Store.
-- Not yet applied to a production project.

create table if not exists public.care_cases (
  tenant_id text not null,
  case_id text not null,
  subject_id text not null,
  source_type text not null check (
    source_type in (
      'non_response',
      'unwell',
      'sos',
      'snow_report',
      'free_text',
      'crisis_no_response',
      'welfare_need_help',
      'manual',
      'external_api'
    )
  ),
  source_adapter text not null,
  source_signal_id text not null,
  priority text not null check (
    priority in ('critical', 'high', 'normal', 'low')
  ),
  status text not null check (
    status in (
      'NEW',
      'ACKNOWLEDGED',
      'ASSIGNED',
      'IN_PROGRESS',
      'HANDOFF_PENDING',
      'COMPLETED',
      'CLOSED'
    )
  ),
  version bigint not null check (version >= 1),
  assignee_id text,
  handoff_target_id text,
  created_at timestamptz not null,
  acknowledged_at timestamptz,
  assigned_at timestamptz,
  first_action_at timestamptz,
  completed_at timestamptz,
  closed_at timestamptz,
  reopened_count integer not null default 0 check (reopened_count >= 0),
  completion jsonb,
  snapshot jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, case_id),
  unique (tenant_id, source_adapter, source_signal_id)
);

create table if not exists public.care_case_events (
  tenant_id text not null,
  case_id text not null,
  sequence bigint not null check (sequence >= 1),
  event_type text not null check (
    event_type in (
      'case_created',
      'priority_changed',
      'acknowledged',
      'assigned',
      'action_started',
      'handoff_requested',
      'handoff_accepted',
      'completed',
      'closed',
      'reopened'
    )
  ),
  actor_id text,
  occurred_at timestamptz not null,
  data jsonb not null,
  event jsonb not null,
  primary key (tenant_id, case_id, sequence),
  foreign key (tenant_id, case_id)
    references public.care_cases (tenant_id, case_id)
    on delete restrict
);

create table if not exists public.care_outbox (
  id bigint generated always as identity primary key,
  tenant_id text not null,
  topic text not null,
  delivery_key text not null,
  payload jsonb not null,
  status text not null default 'pending' check (
    status in (
      'pending',
      'processing',
      'failed',
      'delivered',
      'dead_letter'
    )
  ),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 8 check (max_attempts >= 1),
  available_at timestamptz not null default now(),
  claimed_at timestamptz,
  lease_until timestamptz,
  worker_id text,
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, delivery_key)
);

create index if not exists care_cases_tenant_status_idx
  on public.care_cases (tenant_id, status, created_at);

create index if not exists care_cases_tenant_priority_status_idx
  on public.care_cases (tenant_id, priority, status, created_at);

create index if not exists care_cases_tenant_assignee_idx
  on public.care_cases (tenant_id, assignee_id, status)
  where assignee_id is not null;

create index if not exists care_events_tenant_case_time_idx
  on public.care_case_events (tenant_id, case_id, occurred_at);

create index if not exists care_outbox_ready_idx
  on public.care_outbox (
    tenant_id,
    status,
    available_at,
    id
  )
  where status in ('pending', 'failed', 'processing');

alter table public.care_cases enable row level security;
alter table public.care_case_events enable row level security;
alter table public.care_outbox enable row level security;

revoke all on table public.care_cases from public, anon, authenticated;
revoke all on table public.care_case_events from public, anon, authenticated;
revoke all on table public.care_outbox from public, anon, authenticated;

revoke insert, update, delete on table public.care_cases
  from service_role;
revoke insert, update, delete on table public.care_case_events
  from service_role;
revoke insert, update, delete on table public.care_outbox
  from service_role;

grant select on table public.care_cases to service_role;
grant select on table public.care_case_events to service_role;
grant select on table public.care_outbox to service_role;

revoke usage, select on sequence public.care_outbox_id_seq
  from service_role;

create or replace function public.create_care_case(
  p_snapshot jsonb,
  p_event jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_tenant_id text := nullif(trim(p_snapshot->>'tenantId'), '');
  v_case_id text := nullif(trim(p_snapshot->>'id'), '');
  v_subject_id text := nullif(trim(p_snapshot->>'subjectId'), '');
  v_source_type text := nullif(trim(p_snapshot->>'sourceType'), '');
  v_source_adapter text := nullif(trim(p_snapshot->>'sourceAdapter'), '');
  v_source_signal_id text := nullif(trim(p_snapshot->>'sourceSignalId'), '');
  v_priority text := nullif(trim(p_snapshot->>'priority'), '');
  v_version bigint := (p_snapshot->>'version')::bigint;
  v_event_sequence bigint := (p_event->>'sequence')::bigint;
  v_inserted_case_id text;
  v_existing record;
begin
  if v_tenant_id is null
     or v_case_id is null
     or v_subject_id is null
     or v_source_type is null
     or v_source_adapter is null
     or v_source_signal_id is null
     or v_priority is null then
    raise exception 'case and Signal lineage fields are required';
  end if;

  if v_version <> 1
     or p_snapshot->>'status' <> 'NEW'
     or p_event->>'type' <> 'case_created'
     or v_event_sequence <> 1 then
    raise exception 'invalid case creation payload';
  end if;

  if p_event#>>'{data,tenantId}' is distinct from v_tenant_id
     or p_event#>>'{data,caseId}' is distinct from v_case_id
     or p_event#>>'{data,subjectId}' is distinct from v_subject_id
     or p_event#>>'{data,sourceType}' is distinct from v_source_type
     or p_event#>>'{data,sourceAdapter}' is distinct from v_source_adapter
     or p_event#>>'{data,sourceSignalId}' is distinct from v_source_signal_id
     or p_event#>>'{data,priority}' is distinct from v_priority then
    raise exception 'case creation lineage mismatch';
  end if;

  insert into public.care_cases (
    tenant_id,
    case_id,
    subject_id,
    source_type,
    source_adapter,
    source_signal_id,
    priority,
    status,
    version,
    assignee_id,
    handoff_target_id,
    created_at,
    acknowledged_at,
    assigned_at,
    first_action_at,
    completed_at,
    closed_at,
    reopened_count,
    completion,
    snapshot,
    updated_at
  )
  values (
    v_tenant_id,
    v_case_id,
    v_subject_id,
    v_source_type,
    v_source_adapter,
    v_source_signal_id,
    v_priority,
    p_snapshot->>'status',
    v_version,
    nullif(p_snapshot->>'assigneeId', ''),
    nullif(p_snapshot->>'handoffTargetId', ''),
    (p_snapshot->>'createdAt')::timestamptz,
    nullif(p_snapshot->>'acknowledgedAt', '')::timestamptz,
    nullif(p_snapshot->>'assignedAt', '')::timestamptz,
    nullif(p_snapshot->>'firstActionAt', '')::timestamptz,
    nullif(p_snapshot->>'completedAt', '')::timestamptz,
    nullif(p_snapshot->>'closedAt', '')::timestamptz,
    coalesce((p_snapshot->>'reopenedCount')::integer, 0),
    p_snapshot->'completion',
    p_snapshot,
    now()
  )
  on conflict (tenant_id, source_adapter, source_signal_id)
  do nothing
  returning case_id into v_inserted_case_id;

  if v_inserted_case_id is null then
    select
      case_id,
      subject_id,
      source_type,
      source_adapter,
      source_signal_id,
      version,
      snapshot
      into v_existing
      from public.care_cases
     where tenant_id = v_tenant_id
       and source_adapter = v_source_adapter
       and source_signal_id = v_source_signal_id;

    if not found then
      raise exception 'Signal idempotency index is inconsistent';
    end if;

    if v_existing.subject_id is distinct from v_subject_id
       or v_existing.source_type is distinct from v_source_type then
      return jsonb_build_object(
        'ok', false,
        'conflict', true,
        'reason', 'signal_replay_mismatch',
        'caseId', v_existing.case_id
      );
    end if;

    return jsonb_build_object(
      'ok', true,
      'created', false,
      'caseId', v_existing.case_id,
      'version', v_existing.version,
      'snapshot', v_existing.snapshot
    );
  end if;

  insert into public.care_case_events (
    tenant_id,
    case_id,
    sequence,
    event_type,
    actor_id,
    occurred_at,
    data,
    event
  )
  values (
    v_tenant_id,
    v_case_id,
    v_event_sequence,
    p_event->>'type',
    nullif(p_event->>'actorId', ''),
    (p_event->>'at')::timestamptz,
    coalesce(p_event->'data', '{}'::jsonb),
    p_event
  );

  insert into public.care_outbox (
    tenant_id,
    topic,
    delivery_key,
    payload
  )
  values (
    v_tenant_id,
    'case.event.committed',
    'case-event:' || v_case_id || ':' || v_event_sequence,
    jsonb_build_object(
      'tenantId', v_tenant_id,
      'caseId', v_case_id,
      'sequence', v_event_sequence,
      'event', p_event
    )
  )
  on conflict (tenant_id, delivery_key) do nothing;

  return jsonb_build_object(
    'ok', true,
    'created', true,
    'caseId', v_case_id,
    'version', v_version,
    'snapshot', p_snapshot
  );
end;
$$;

create or replace function public.append_care_case_event(
  p_tenant_id text,
  p_case_id text,
  p_expected_version bigint,
  p_snapshot jsonb,
  p_event jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_current_version bigint;
  v_subject_id text;
  v_source_type text;
  v_source_adapter text;
  v_source_signal_id text;
  v_created_at timestamptz;
  v_next_version bigint := p_expected_version + 1;
  v_snapshot_version bigint := (p_snapshot->>'version')::bigint;
  v_event_sequence bigint := (p_event->>'sequence')::bigint;
begin
  select
    version,
    subject_id,
    source_type,
    source_adapter,
    source_signal_id,
    created_at
    into
      v_current_version,
      v_subject_id,
      v_source_type,
      v_source_adapter,
      v_source_signal_id,
      v_created_at
    from public.care_cases
   where tenant_id = p_tenant_id
     and case_id = p_case_id
   for update;

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

  if p_snapshot->>'tenantId' is distinct from p_tenant_id
     or p_snapshot->>'id' is distinct from p_case_id
     or p_snapshot->>'subjectId' is distinct from v_subject_id
     or p_snapshot->>'sourceType' is distinct from v_source_type
     or p_snapshot->>'sourceAdapter' is distinct from v_source_adapter
     or p_snapshot->>'sourceSignalId' is distinct from v_source_signal_id
     or (p_snapshot->>'createdAt')::timestamptz is distinct from v_created_at
     or v_snapshot_version <> v_next_version
     or v_event_sequence <> v_next_version
     or p_event->>'type' = 'case_created' then
    raise exception 'invalid append payload or immutable lineage mutation';
  end if;

  update public.care_cases
     set priority = p_snapshot->>'priority',
         status = p_snapshot->>'status',
         version = v_next_version,
         assignee_id = nullif(p_snapshot->>'assigneeId', ''),
         handoff_target_id = nullif(p_snapshot->>'handoffTargetId', ''),
         acknowledged_at = nullif(p_snapshot->>'acknowledgedAt', '')::timestamptz,
         assigned_at = nullif(p_snapshot->>'assignedAt', '')::timestamptz,
         first_action_at = nullif(p_snapshot->>'firstActionAt', '')::timestamptz,
         completed_at = nullif(p_snapshot->>'completedAt', '')::timestamptz,
         closed_at = nullif(p_snapshot->>'closedAt', '')::timestamptz,
         reopened_count = coalesce((p_snapshot->>'reopenedCount')::integer, 0),
         completion = p_snapshot->'completion',
         snapshot = p_snapshot,
         updated_at = now()
   where tenant_id = p_tenant_id
     and case_id = p_case_id;

  insert into public.care_case_events (
    tenant_id,
    case_id,
    sequence,
    event_type,
    actor_id,
    occurred_at,
    data,
    event
  )
  values (
    p_tenant_id,
    p_case_id,
    v_event_sequence,
    p_event->>'type',
    nullif(p_event->>'actorId', ''),
    (p_event->>'at')::timestamptz,
    coalesce(p_event->'data', '{}'::jsonb),
    p_event
  );

  insert into public.care_outbox (
    tenant_id,
    topic,
    delivery_key,
    payload
  )
  values (
    p_tenant_id,
    'case.event.committed',
    'case-event:' || p_case_id || ':' || v_event_sequence,
    jsonb_build_object(
      'tenantId', p_tenant_id,
      'caseId', p_case_id,
      'sequence', v_event_sequence,
      'event', p_event
    )
  )
  on conflict (tenant_id, delivery_key) do nothing;

  return jsonb_build_object(
    'ok', true,
    'version', v_next_version
  );
end;
$$;

create or replace function public.enqueue_care_outbox(
  p_tenant_id text,
  p_topic text,
  p_delivery_key text,
  p_payload jsonb,
  p_available_at timestamptz default now(),
  p_max_attempts integer default 8
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_id bigint;
  v_created boolean := false;
  v_existing record;
begin
  if nullif(trim(p_tenant_id), '') is null
     or nullif(trim(p_topic), '') is null
     or nullif(trim(p_delivery_key), '') is null then
    raise exception 'tenant, topic, and delivery key are required';
  end if;

  if p_max_attempts < 1 then
    raise exception 'max attempts must be positive';
  end if;

  insert into public.care_outbox (
    tenant_id,
    topic,
    delivery_key,
    payload,
    available_at,
    max_attempts
  )
  values (
    p_tenant_id,
    p_topic,
    p_delivery_key,
    p_payload,
    coalesce(p_available_at, now()),
    p_max_attempts
  )
  on conflict (tenant_id, delivery_key) do nothing
  returning id into v_id;

  if v_id is not null then
    v_created := true;
  else
    select id, topic, payload
      into v_existing
      from public.care_outbox
     where tenant_id = p_tenant_id
       and delivery_key = p_delivery_key;

    if not found then
      raise exception 'outbox idempotency index is inconsistent';
    end if;

    v_id := v_existing.id;

    if v_existing.topic is distinct from p_topic
       or v_existing.payload is distinct from p_payload then
      return jsonb_build_object(
        'ok', false,
        'conflict', true,
        'reason', 'delivery_key_reuse',
        'id', v_id
      );
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'created', v_created,
    'id', v_id
  );
end;
$$;

create or replace function public.claim_care_outbox(
  p_tenant_id text,
  p_worker_id text,
  p_limit integer default 50,
  p_lease_seconds integer default 60
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_result jsonb;
begin
  if nullif(trim(p_tenant_id), '') is null
     or nullif(trim(p_worker_id), '') is null then
    raise exception 'tenant and worker are required';
  end if;

  if p_limit < 1 or p_limit > 100 then
    raise exception 'claim limit must be between 1 and 100';
  end if;

  if p_lease_seconds < 1 or p_lease_seconds > 3600 then
    raise exception 'lease seconds must be between 1 and 3600';
  end if;

  update public.care_outbox
     set status = 'dead_letter',
         worker_id = null,
         lease_until = null,
         updated_at = now()
   where tenant_id = p_tenant_id
     and status = 'processing'
     and lease_until < now()
     and attempt_count >= max_attempts;

  with candidates as (
    select id
      from public.care_outbox
     where tenant_id = p_tenant_id
       and attempt_count < max_attempts
       and (
         (
           status in ('pending', 'failed')
           and available_at <= now()
         )
         or (
           status = 'processing'
           and lease_until < now()
         )
       )
     order by available_at, id
     for update skip locked
     limit p_limit
  ),
  claimed as (
    update public.care_outbox o
       set status = 'processing',
           attempt_count = o.attempt_count + 1,
           claimed_at = now(),
           lease_until = now() + make_interval(secs => p_lease_seconds),
           worker_id = p_worker_id,
           updated_at = now()
      from candidates c
     where o.id = c.id
    returning o.*
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', id,
        'tenantId', tenant_id,
        'topic', topic,
        'deliveryKey', delivery_key,
        'payload', payload,
        'status', status,
        'attemptCount', attempt_count,
        'maxAttempts', max_attempts,
        'availableAt', available_at,
        'claimedAt', claimed_at,
        'leaseUntil', lease_until,
        'workerId', worker_id
      )
      order by id
    ),
    '[]'::jsonb
  )
    into v_result
    from claimed;

  return v_result;
end;
$$;

create or replace function public.complete_care_outbox(
  p_tenant_id text,
  p_id bigint,
  p_worker_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_updated bigint;
begin
  update public.care_outbox
     set status = 'delivered',
         delivered_at = now(),
         lease_until = null,
         last_error = null,
         updated_at = now()
   where tenant_id = p_tenant_id
     and id = p_id
     and status = 'processing'
     and worker_id = p_worker_id
  returning id into v_updated;

  return jsonb_build_object(
    'ok', v_updated is not null,
    'id', p_id
  );
end;
$$;

create or replace function public.fail_care_outbox(
  p_tenant_id text,
  p_id bigint,
  p_worker_id text,
  p_error text,
  p_retry_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_updated bigint;
  v_status text;
begin
  update public.care_outbox
     set status = case
           when attempt_count >= max_attempts
             then 'dead_letter'
           else 'failed'
         end,
         available_at = case
           when attempt_count >= max_attempts
             then available_at
           else coalesce(p_retry_at, now())
         end,
         worker_id = null,
         lease_until = null,
         last_error = left(coalesce(p_error, 'delivery failed'), 1000),
         updated_at = now()
   where tenant_id = p_tenant_id
     and id = p_id
     and status = 'processing'
     and worker_id = p_worker_id
  returning id, status into v_updated, v_status;

  return jsonb_build_object(
    'ok', v_updated is not null,
    'id', p_id,
    'status', v_status
  );
end;
$$;

create or replace function public.get_care_outbox_health(
  p_tenant_id text,
  p_include_delivered boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_result jsonb;
begin
  if nullif(trim(p_tenant_id), '') is null then
    raise exception 'tenant is required';
  end if;

  select jsonb_build_object(
    'tenantId', p_tenant_id,
    'evaluatedAt', now(),
    'counts', jsonb_build_object(
      'pending', count(*) filter (where status = 'pending'),
      'processing', count(*) filter (where status = 'processing'),
      'failed', count(*) filter (where status = 'failed'),
      'deadLetter', count(*) filter (where status = 'dead_letter'),
      'delivered',
        case
          when p_include_delivered
            then count(*) filter (where status = 'delivered')
          else null
        end
    ),
    'oldestActionableAt',
      min(
        case
          when status in ('pending', 'failed', 'processing')
            then available_at
          else null
        end
      ),
    'oldestDeadLetterAt',
      min(
        case
          when status = 'dead_letter'
            then updated_at
          else null
        end
      ),
    'maxAttemptCount',
      coalesce(max(attempt_count), 0)
  )
    into v_result
    from public.care_outbox
   where tenant_id = p_tenant_id;

  return v_result;
end;
$$;

revoke execute on function public.create_care_case(jsonb, jsonb)
  from public, anon, authenticated;
revoke execute on function public.append_care_case_event(text, text, bigint, jsonb, jsonb)
  from public, anon, authenticated;

grant execute on function public.create_care_case(jsonb, jsonb)
  to service_role;
grant execute on function public.append_care_case_event(text, text, bigint, jsonb, jsonb)
  to service_role;

revoke execute on function public.get_care_outbox_health(text, boolean)
  from public, anon, authenticated;

grant execute on function public.get_care_outbox_health(text, boolean)
  to service_role;

revoke execute on function public.enqueue_care_outbox(text, text, text, jsonb, timestamptz, integer)
  from public, anon, authenticated;
revoke execute on function public.claim_care_outbox(text, text, integer, integer)
  from public, anon, authenticated;
revoke execute on function public.complete_care_outbox(text, bigint, text)
  from public, anon, authenticated;
revoke execute on function public.fail_care_outbox(text, bigint, text, text, timestamptz)
  from public, anon, authenticated;

grant execute on function public.enqueue_care_outbox(text, text, text, jsonb, timestamptz, integer)
  to service_role;
grant execute on function public.claim_care_outbox(text, text, integer, integer)
  to service_role;
grant execute on function public.complete_care_outbox(text, bigint, text)
  to service_role;
grant execute on function public.fail_care_outbox(text, bigint, text, text, timestamptz)
  to service_role;
