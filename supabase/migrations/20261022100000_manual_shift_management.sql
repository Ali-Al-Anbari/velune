-- Manual creation and completed-shift editing are owner-only atomic operations.
-- Apply manually after review; this migration does not modify existing shift data.
begin;

alter table public.shifts
  add column manual_creation_request_id uuid,
  add column manual_edit_version integer not null default 0,
  add constraint shifts_manual_edit_version_valid check (manual_edit_version >= 0);

create unique index shifts_manual_creation_request
  on public.shifts (user_id, manual_creation_request_id)
  where manual_creation_request_id is not null;

-- Reject malformed, out-of-range, duplicate, and overlapping break payloads before writes.
create function public.validate_manual_shift_breaks(
  p_breaks jsonb,
  p_started_at timestamptz,
  p_ended_at timestamptz,
  p_shift_id uuid default null
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_item record;
begin
  if p_breaks is null or pg_catalog.jsonb_typeof(p_breaks) <> 'array' then
    raise exception 'Breaks must be an array' using errcode = '22023';
  end if;

  for v_item in
    select (item->>'id')::uuid as id,
      (item->>'started_at')::timestamptz as started_at,
      (item->>'ended_at')::timestamptz as ended_at,
      (item->>'is_paid')::boolean as is_paid
    from pg_catalog.jsonb_array_elements(p_breaks) as entries(item)
  loop
    if v_item.id is null or v_item.started_at is null or v_item.ended_at is null or v_item.is_paid is null then
      raise exception 'Each break needs an ID, start, end and paid status' using errcode = '22023';
    end if;
    if v_item.started_at >= v_item.ended_at then
      raise exception 'Break start must be earlier than break end' using errcode = '22023';
    end if;
    if v_item.started_at < p_started_at or v_item.ended_at > p_ended_at then
      raise exception 'Breaks must fall within shift boundaries' using errcode = '22023';
    end if;
    if exists (
      select 1 from public.breaks b
      where b.id = v_item.id and (p_shift_id is null or b.shift_id <> p_shift_id)
    ) then
      raise exception 'Break not found' using errcode = '42501';
    end if;
  end loop;

  if exists (
    select (item->>'id')::uuid
    from pg_catalog.jsonb_array_elements(p_breaks) as entries(item)
    group by (item->>'id')::uuid having count(*) > 1
  ) then
    raise exception 'Break IDs must be unique' using errcode = '22023';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_breaks) as left_entry(item)
    join pg_catalog.jsonb_array_elements(p_breaks) as right_entry(item)
      on (left_entry.item->>'id')::uuid < (right_entry.item->>'id')::uuid
    where pg_catalog.tstzrange(
        (left_entry.item->>'started_at')::timestamptz,
        (left_entry.item->>'ended_at')::timestamptz, '[)'
      ) && pg_catalog.tstzrange(
        (right_entry.item->>'started_at')::timestamptz,
        (right_entry.item->>'ended_at')::timestamptz, '[)'
      )
  ) then
    raise exception 'Breaks cannot overlap' using errcode = '22023';
  end if;
end;
$$;

create function public.create_manual_shift(
  p_shift_id uuid,
  p_request_id uuid,
  p_started_at timestamptz,
  p_ended_at timestamptz,
  p_wage_profile_id uuid default null,
  p_hourly_wage_override_cents integer default null,
  p_breaks jsonb default '[]'::jsonb
)
returns public.shifts
language plpgsql security definer set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_shift public.shifts%rowtype;
  v_profile public.wage_profiles%rowtype;
begin
  if v_user_id is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  if p_shift_id is null or p_request_id is null then
    raise exception 'Shift and request IDs are required' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text, 0));

  select * into v_shift from public.shifts
  where user_id = v_user_id and manual_creation_request_id = p_request_id;
  if found then return v_shift; end if;

  if p_started_at is null or p_ended_at is null or p_started_at >= p_ended_at then
    raise exception 'Shift start must be earlier than shift end' using errcode = '22023';
  end if;
  if p_ended_at > pg_catalog.clock_timestamp() then
    raise exception 'Manual shifts must end in the past' using errcode = '22023';
  end if;
  if p_ended_at - p_started_at > interval '24 hours' then
    raise exception 'A shift cannot be longer than 24 hours' using errcode = '22023';
  end if;
  if p_hourly_wage_override_cents is not null
    and p_hourly_wage_override_cents not between 1 and 1000000 then
    raise exception 'Hourly wage override is out of range' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.shifts s where s.user_id = v_user_id
      and s.started_at < p_ended_at
      and coalesce(s.ended_at, 'infinity'::timestamptz) > p_started_at
  ) then raise exception 'This time overlaps another shift' using errcode = '23P01'; end if;

  if p_wage_profile_id is not null then
    select * into v_profile from public.wage_profiles
    where id = p_wage_profile_id and user_id = v_user_id and not is_archived
    for share;
    if not found then raise exception 'Wage profile not found' using errcode = '42501'; end if;
  end if;

  perform public.validate_manual_shift_breaks(p_breaks, p_started_at, p_ended_at);
  insert into public.shifts (
    id, user_id, started_at, ended_at, manual_creation_request_id,
    wage_profile_id, wage_profile_name_snapshot, hourly_wage_cents_snapshot,
    hourly_wage_override_cents, normally_tipped_snapshot,
    include_tips_in_tax_estimate_snapshot, estimated_withholding_bps_snapshot
  ) values (
    p_shift_id, v_user_id, p_started_at, p_ended_at, p_request_id,
    p_wage_profile_id, v_profile.name,
    coalesce(p_hourly_wage_override_cents, v_profile.hourly_wage_cents),
    p_hourly_wage_override_cents, v_profile.normally_tipped,
    v_profile.include_tips_in_tax_estimate, v_profile.estimated_withholding_bps
  ) returning * into v_shift;

  insert into public.breaks (id, shift_id, started_at, ended_at, is_paid)
    select (item->>'id')::uuid, v_shift.id,
      (item->>'started_at')::timestamptz, (item->>'ended_at')::timestamptz,
      (item->>'is_paid')::boolean
    from pg_catalog.jsonb_array_elements(p_breaks) as entries(item);
  return v_shift;
end;
$$;

create function public.update_completed_shift(
  p_shift_id uuid,
  p_expected_edit_version integer,
  p_started_at timestamptz,
  p_ended_at timestamptz,
  p_wage_profile_id uuid,
  p_hourly_wage_override_cents integer,
  p_breaks jsonb
)
returns public.shifts
language plpgsql security definer set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_shift public.shifts%rowtype;
  v_profile public.wage_profiles%rowtype;
  v_hourly_snapshot integer;
  v_profile_name text;
  v_normally_tipped boolean;
  v_include_tips boolean;
  v_withholding_bps integer;
  v_profile_changed boolean;
  v_override_changed boolean;
begin
  if v_user_id is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  if p_shift_id is null or p_expected_edit_version is null then
    raise exception 'Shift ID and edit version are required' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text, 0));
  select * into v_shift from public.shifts where id = p_shift_id and user_id = v_user_id for update;
  if not found or v_shift.ended_at is null then raise exception 'Completed shift not found' using errcode = '42501'; end if;
  if v_shift.manual_edit_version <> p_expected_edit_version then
    raise exception 'This shift changed elsewhere. Reload before editing again.' using errcode = '40001';
  end if;

  if p_started_at is null or p_ended_at is null or p_started_at >= p_ended_at then
    raise exception 'Shift start must be earlier than shift end' using errcode = '22023';
  end if;
  if p_ended_at > pg_catalog.clock_timestamp() then
    raise exception 'Manual shifts must end in the past' using errcode = '22023';
  end if;
  if p_ended_at - p_started_at > interval '24 hours' then
    raise exception 'A shift cannot be longer than 24 hours' using errcode = '22023';
  end if;
  if p_hourly_wage_override_cents is not null
    and p_hourly_wage_override_cents not between 1 and 1000000 then
    raise exception 'Hourly wage override is out of range' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.shifts s where s.user_id = v_user_id and s.id <> p_shift_id
      and s.started_at < p_ended_at
      and coalesce(s.ended_at, 'infinity'::timestamptz) > p_started_at
  ) then raise exception 'This time overlaps another shift' using errcode = '23P01'; end if;

  v_profile_changed := p_wage_profile_id is distinct from v_shift.wage_profile_id;
  v_override_changed := p_hourly_wage_override_cents is distinct from v_shift.hourly_wage_override_cents;
  if v_profile_changed and p_wage_profile_id is not null then
    select * into v_profile from public.wage_profiles
    where id = p_wage_profile_id and user_id = v_user_id and not is_archived
    for share;
    if not found then raise exception 'Wage profile not found' using errcode = '42501'; end if;
  end if;

  if v_profile_changed then
    v_profile_name := v_profile.name;
    v_normally_tipped := v_profile.normally_tipped;
    v_include_tips := v_profile.include_tips_in_tax_estimate;
    v_withholding_bps := v_profile.estimated_withholding_bps;
    v_hourly_snapshot := coalesce(p_hourly_wage_override_cents, v_profile.hourly_wage_cents);
    if p_wage_profile_id is null then v_hourly_snapshot := p_hourly_wage_override_cents; end if;
  else
    v_profile_name := v_shift.wage_profile_name_snapshot;
    v_normally_tipped := v_shift.normally_tipped_snapshot;
    v_include_tips := v_shift.include_tips_in_tax_estimate_snapshot;
    v_withholding_bps := v_shift.estimated_withholding_bps_snapshot;
    v_hourly_snapshot := v_shift.hourly_wage_cents_snapshot;
    if v_override_changed then
      if p_hourly_wage_override_cents is not null then
        v_hourly_snapshot := p_hourly_wage_override_cents;
      elsif p_wage_profile_id is not null then
        select * into v_profile from public.wage_profiles
        where id = p_wage_profile_id and user_id = v_user_id;
        if not found then raise exception 'Wage profile not found' using errcode = '42501'; end if;
        v_hourly_snapshot := v_profile.hourly_wage_cents;
      else
        v_hourly_snapshot := null;
      end if;
    end if;
  end if;

  perform public.validate_manual_shift_breaks(p_breaks, p_started_at, p_ended_at, p_shift_id);
  update public.shifts set
    started_at = p_started_at,
    ended_at = p_ended_at,
    wage_profile_id = p_wage_profile_id,
    wage_profile_name_snapshot = v_profile_name,
    hourly_wage_cents_snapshot = v_hourly_snapshot,
    hourly_wage_override_cents = p_hourly_wage_override_cents,
    normally_tipped_snapshot = v_normally_tipped,
    include_tips_in_tax_estimate_snapshot = v_include_tips,
    estimated_withholding_bps_snapshot = v_withholding_bps,
    manual_edit_version = manual_edit_version + 1
  where id = p_shift_id and user_id = v_user_id returning * into v_shift;

  delete from public.breaks where shift_id = p_shift_id;
  insert into public.breaks (id, shift_id, started_at, ended_at, is_paid)
    select (item->>'id')::uuid, p_shift_id,
      (item->>'started_at')::timestamptz, (item->>'ended_at')::timestamptz,
      (item->>'is_paid')::boolean
    from pg_catalog.jsonb_array_elements(p_breaks) as entries(item);
  return v_shift;
end;
$$;

revoke all on function public.validate_manual_shift_breaks(jsonb, timestamptz, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.create_manual_shift(uuid, uuid, timestamptz, timestamptz, uuid, integer, jsonb) from public, anon, authenticated;
revoke all on function public.update_completed_shift(uuid, integer, timestamptz, timestamptz, uuid, integer, jsonb) from public, anon, authenticated;
grant execute on function public.create_manual_shift(uuid, uuid, timestamptz, timestamptz, uuid, integer, jsonb) to authenticated;
grant execute on function public.update_completed_shift(uuid, integer, timestamptz, timestamptz, uuid, integer, jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
