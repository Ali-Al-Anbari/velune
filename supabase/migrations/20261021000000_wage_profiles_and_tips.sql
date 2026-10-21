-- Review and apply manually. Existing shifts remain valid without a wage profile.
begin;

create table public.wage_profiles (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  hourly_wage_cents integer not null,
  normally_tipped boolean not null default false,
  include_tips_in_tax_estimate boolean not null default true,
  estimated_withholding_bps integer,
  is_default boolean not null default false,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wage_profiles_owner_key unique (id, user_id),
  constraint wage_profiles_name_valid check (
    char_length(name) between 2 and 80
    and name = btrim(name)
    and name ~ '[^[:space:]]'
  ),
  constraint wage_profiles_wage_valid check (hourly_wage_cents between 1 and 1000000),
  constraint wage_profiles_withholding_valid check (estimated_withholding_bps between 0 and 10000),
  constraint wage_profiles_archived_not_default check (not (is_archived and is_default))
);

create index wage_profiles_owner_active on public.wage_profiles (user_id, is_archived, name);
create unique index wage_profiles_one_active_default on public.wage_profiles (user_id)
  where is_default and not is_archived;

alter table public.shifts
  add column wage_profile_id uuid,
  add column wage_profile_name_snapshot text,
  add column hourly_wage_cents_snapshot integer,
  add column hourly_wage_override_cents integer,
  add column normally_tipped_snapshot boolean,
  add column include_tips_in_tax_estimate_snapshot boolean,
  add column estimated_withholding_bps_snapshot integer,
  add constraint shifts_wage_profile_owner foreign key (wage_profile_id, user_id)
    references public.wage_profiles (id, user_id) on delete restrict,
  add constraint shifts_snapshot_wage_valid check (hourly_wage_cents_snapshot between 1 and 1000000),
  add constraint shifts_override_wage_valid check (hourly_wage_override_cents between 1 and 1000000),
  add constraint shifts_snapshot_withholding_valid check (estimated_withholding_bps_snapshot between 0 and 10000),
  add constraint shifts_profile_snapshot_present check (
    wage_profile_id is null or (
      wage_profile_name_snapshot is not null
      and hourly_wage_cents_snapshot is not null
      and normally_tipped_snapshot is not null
      and include_tips_in_tax_estimate_snapshot is not null
    )
  );

create index shifts_wage_profile on public.shifts (wage_profile_id)
  where wage_profile_id is not null;

create table public.tips (
  id uuid primary key,
  shift_id uuid not null references public.shifts (id) on delete cascade,
  amount_cents integer not null,
  label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tips_amount_valid check (amount_cents between 1 and 1000000),
  constraint tips_label_valid check (label is null or label in ('Cash', 'Card', 'Other'))
);

create index tips_shift_created on public.tips (shift_id, created_at);

create function public.touch_wage_or_tip_updated_at()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end;
$$;

create trigger wage_profiles_touch_updated_at before update on public.wage_profiles
  for each row execute function public.touch_wage_or_tip_updated_at();
create trigger tips_touch_updated_at before update on public.tips
  for each row execute function public.touch_wage_or_tip_updated_at();

alter table public.wage_profiles enable row level security;
alter table public.tips enable row level security;

revoke all on table public.wage_profiles, public.tips from public, anon, authenticated;
grant select on table public.wage_profiles, public.tips to authenticated;
grant insert (id, user_id, name, hourly_wage_cents, normally_tipped,
  include_tips_in_tax_estimate, estimated_withholding_bps, is_default) on public.wage_profiles to authenticated;
grant update (name, hourly_wage_cents, normally_tipped,
  include_tips_in_tax_estimate, estimated_withholding_bps, is_default, is_archived)
  on public.wage_profiles to authenticated;
grant insert (id, shift_id, amount_cents, label) on public.tips to authenticated;
grant update (amount_cents, label) on public.tips to authenticated;
grant delete on public.tips to authenticated;

create policy "Read own wage profiles" on public.wage_profiles for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Create own wage profiles" on public.wage_profiles for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "Edit own wage profiles" on public.wage_profiles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "Read tips of own shifts" on public.tips for select to authenticated
  using (exists (select 1 from public.shifts s
    where s.id = shift_id and s.user_id = (select auth.uid())));
create policy "Create tips on own shifts" on public.tips for insert to authenticated
  with check (exists (select 1 from public.shifts s
    where s.id = shift_id and s.user_id = (select auth.uid())));
create policy "Edit tips on own shifts" on public.tips for update to authenticated
  using (exists (select 1 from public.shifts s
    where s.id = shift_id and s.user_id = (select auth.uid())))
  with check (exists (select 1 from public.shifts s
    where s.id = shift_id and s.user_id = (select auth.uid())));
create policy "Delete tips on own shifts" on public.tips for delete to authenticated
  using (exists (select 1 from public.shifts s
    where s.id = shift_id and s.user_id = (select auth.uid())));

-- Setting a default touches two rows. Keep both updates atomic under the caller's RLS.
create function public.set_default_wage_profile(p_profile_id uuid)
returns void language plpgsql security invoker set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text, 0));
  if not exists (select 1 from public.wage_profiles
    where id = p_profile_id and user_id = v_user_id and not is_archived) then
    raise exception 'Wage profile not found' using errcode = '42501';
  end if;
  update public.wage_profiles set is_default = false
    where user_id = v_user_id and is_default;
  update public.wage_profiles set is_default = true
    where id = p_profile_id and user_id = v_user_id and not is_archived;
end;
$$;
revoke execute on function public.set_default_wage_profile(uuid) from public, anon, authenticated;
grant execute on function public.set_default_wage_profile(uuid) to authenticated;

-- Replace only start_shift. Defaults keep the previous one-argument RPC call working.
drop function public.start_shift(uuid);
create function public.start_shift(
  p_shift_id uuid,
  p_wage_profile_id uuid default null,
  p_hourly_wage_override_cents integer default null
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
  if p_shift_id is null then raise exception 'A shift request ID is required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text, 0));

  select * into v_shift from public.shifts where id = p_shift_id;
  if found then
    if v_shift.user_id <> v_user_id then raise exception 'Shift not found' using errcode = '42501'; end if;
    return v_shift; -- Retries preserve the original profile and every pay snapshot.
  end if;

  if exists (select 1 from public.shifts where user_id = v_user_id and ended_at is null) then
    raise exception 'An active shift already exists';
  end if;
  if p_hourly_wage_override_cents is not null
    and p_hourly_wage_override_cents not between 1 and 1000000 then
    raise exception 'Hourly wage override is out of range';
  end if;

  if p_wage_profile_id is not null then
    select * into v_profile from public.wage_profiles
    where id = p_wage_profile_id and user_id = v_user_id and not is_archived
    for share;
    if not found then raise exception 'Wage profile not found' using errcode = '42501'; end if;
  end if;

  insert into public.shifts (
    id, user_id, started_at, wage_profile_id, wage_profile_name_snapshot,
    hourly_wage_cents_snapshot, hourly_wage_override_cents,
    normally_tipped_snapshot, include_tips_in_tax_estimate_snapshot,
    estimated_withholding_bps_snapshot
  ) values (
    p_shift_id, v_user_id, pg_catalog.clock_timestamp(), p_wage_profile_id,
    v_profile.name, coalesce(p_hourly_wage_override_cents, v_profile.hourly_wage_cents),
    p_hourly_wage_override_cents, v_profile.normally_tipped,
    v_profile.include_tips_in_tax_estimate, v_profile.estimated_withholding_bps
  ) returning * into v_shift;
  return v_shift;
end;
$$;

revoke execute on function public.start_shift(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.start_shift(uuid, uuid, integer) to authenticated;

notify pgrst, 'reload schema';
commit;
