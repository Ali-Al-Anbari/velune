-- Apply manually after review. This RPC deletes only one caller-owned completed shift.
begin;

create function public.delete_completed_shift(p_shift_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_shift public.shifts%rowtype;
begin
  if v_user_id is null then
    raise exception 'Sign in required' using errcode = '42501';
  end if;
  if p_shift_id is null then
    raise exception 'Shift ID is required' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text, 0));

  select * into v_shift
  from public.shifts
  where id = p_shift_id and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Completed shift not found' using errcode = '42501';
  end if;
  if v_shift.ended_at is null then
    raise exception 'Active shifts cannot be deleted' using errcode = '22023';
  end if;

  delete from public.shifts
  where id = p_shift_id and user_id = v_user_id and ended_at is not null;
end;
$$;

revoke all on function public.delete_completed_shift(uuid) from public, anon, authenticated;
grant execute on function public.delete_completed_shift(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
