-- Apply manually after review. All lifecycle writes go through these atomic RPCs.
begin;

create table public.shifts (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz,
  constraint shifts_time_order check (ended_at is null or ended_at > started_at)
);

create unique index shifts_one_active_per_user on public.shifts (user_id)
  where ended_at is null;
create index shifts_user_started_at on public.shifts (user_id, started_at desc);

create table public.breaks (
  id uuid primary key,
  shift_id uuid not null references public.shifts (id) on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz,
  is_paid boolean not null,
  constraint breaks_time_order check (ended_at is null or ended_at > started_at)
);

create unique index breaks_one_active_per_shift on public.breaks (shift_id)
  where ended_at is null;
create index breaks_shift_started_at on public.breaks (shift_id, started_at);

alter table public.shifts enable row level security;
alter table public.breaks enable row level security;

-- Callers can read only their own rows. Direct writes are denied; the functions below
-- check auth.uid() and perform each lifecycle transition in one transaction.
revoke all on table public.shifts, public.breaks from public, anon, authenticated;
grant select on table public.shifts, public.breaks to authenticated;

create policy "Read own shifts" on public.shifts for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Read breaks of own shifts" on public.breaks for select to authenticated
  using (exists (
    select 1 from public.shifts s
    where s.id = shift_id and s.user_id = (select auth.uid())
  ));

create function public.start_shift(p_shift_id uuid)
returns public.shifts
language plpgsql security definer set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_shift public.shifts%rowtype;
begin
  if v_user_id is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  if p_shift_id is null then raise exception 'A shift request ID is required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text, 0));

  select * into v_shift from public.shifts where id = p_shift_id;
  if found then
    if v_shift.user_id <> v_user_id then raise exception 'Shift not found' using errcode = '42501'; end if;
    return v_shift; -- Same request ID: safe retry, even after the shift ended.
  end if;

  if exists (select 1 from public.shifts where user_id = v_user_id and ended_at is null) then
    raise exception 'An active shift already exists';
  end if;

  insert into public.shifts (id, user_id, started_at)
  values (p_shift_id, v_user_id, pg_catalog.clock_timestamp())
  returning * into v_shift;
  return v_shift;
end;
$$;

create function public.begin_break(p_shift_id uuid, p_break_id uuid, p_is_paid boolean)
returns public.breaks
language plpgsql security definer set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_shift public.shifts%rowtype;
  v_break public.breaks%rowtype;
  v_last_end timestamptz;
begin
  if v_user_id is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  if p_shift_id is null or p_break_id is null or p_is_paid is null then
    raise exception 'Shift, break and paid status are required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text, 0));

  select * into v_shift from public.shifts where id = p_shift_id and user_id = v_user_id;
  if not found then raise exception 'Shift not found' using errcode = '42501'; end if;

  select * into v_break from public.breaks where id = p_break_id;
  if found then
    if v_break.shift_id <> p_shift_id or v_break.is_paid <> p_is_paid then
      raise exception 'Break request ID was already used' using errcode = '42501';
    end if;
    return v_break;
  end if;

  if v_shift.ended_at is not null then raise exception 'This shift has ended'; end if;
  if exists (select 1 from public.breaks where shift_id = p_shift_id and ended_at is null) then
    raise exception 'A break is already active';
  end if;

  select max(ended_at) into v_last_end from public.breaks where shift_id = p_shift_id;

  insert into public.breaks (id, shift_id, started_at, is_paid)
  values (p_break_id, p_shift_id,
    greatest(pg_catalog.clock_timestamp(),
      coalesce(v_last_end, v_shift.started_at) + interval '1 microsecond'), p_is_paid)
  returning * into v_break;
  return v_break;
end;
$$;

create function public.end_break(p_shift_id uuid, p_break_id uuid)
returns public.breaks
language plpgsql security definer set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_break public.breaks%rowtype;
begin
  if v_user_id is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  if p_shift_id is null or p_break_id is null then raise exception 'Shift and break IDs are required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text, 0));

  select b.* into v_break from public.breaks b
  join public.shifts s on s.id = b.shift_id
  where b.id = p_break_id and b.shift_id = p_shift_id and s.user_id = v_user_id;
  if not found then raise exception 'Break not found' using errcode = '42501'; end if;
  if v_break.ended_at is not null then return v_break; end if;

  update public.breaks set ended_at = greatest(
    pg_catalog.clock_timestamp(), v_break.started_at + interval '1 microsecond')
  where id = p_break_id returning * into v_break;
  return v_break;
end;
$$;

create function public.end_shift(p_shift_id uuid)
returns public.shifts
language plpgsql security definer set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_shift public.shifts%rowtype;
  v_break public.breaks%rowtype;
  v_end timestamptz;
  v_last_end timestamptz;
begin
  if v_user_id is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  if p_shift_id is null then raise exception 'A shift ID is required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text, 0));

  select * into v_shift from public.shifts where id = p_shift_id and user_id = v_user_id;
  if not found then raise exception 'Shift not found' using errcode = '42501'; end if;
  if v_shift.ended_at is not null then return v_shift; end if;

  select * into v_break from public.breaks where shift_id = p_shift_id and ended_at is null;
  select max(ended_at) into v_last_end from public.breaks where shift_id = p_shift_id;
  v_end := greatest(pg_catalog.clock_timestamp(),
    coalesce(v_last_end, v_shift.started_at) + interval '1 microsecond');
  if v_break.id is not null then
    v_end := greatest(v_end, v_break.started_at + interval '1 microsecond');
    update public.breaks set ended_at = v_end where id = v_break.id;
  end if;

  update public.shifts set ended_at = v_end where id = p_shift_id
  returning * into v_shift;
  return v_shift;
end;
$$;

revoke execute on function public.start_shift(uuid) from public, anon, authenticated;
revoke execute on function public.begin_break(uuid, uuid, boolean) from public, anon, authenticated;
revoke execute on function public.end_break(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.end_shift(uuid) from public, anon, authenticated;
grant execute on function public.start_shift(uuid) to authenticated;
grant execute on function public.begin_break(uuid, uuid, boolean) to authenticated;
grant execute on function public.end_break(uuid, uuid) to authenticated;
grant execute on function public.end_shift(uuid) to authenticated;

commit;
