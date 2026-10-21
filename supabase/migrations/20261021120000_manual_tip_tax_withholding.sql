-- Apply manually after review. Tip tax withholding is entered by the user; no tax rate is estimated.
begin;

alter table public.shifts
  add column tip_tax_withheld_cents integer,
  add constraint shifts_tip_tax_withheld_valid
    check (tip_tax_withheld_cents is null or tip_tax_withheld_cents between 0 and 1000000);

-- Shifts intentionally have no direct update grant. This narrowly scoped RPC permits
-- an authenticated owner to set or clear the manual amount on an active or completed shift.
create function public.set_shift_tip_tax_withheld(
  p_shift_id uuid,
  p_tip_tax_withheld_cents integer
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Sign in required' using errcode = '42501';
  end if;
  if p_shift_id is null then
    raise exception 'A shift ID is required' using errcode = '22023';
  end if;
  if p_tip_tax_withheld_cents is not null
    and p_tip_tax_withheld_cents not between 0 and 1000000 then
    raise exception 'Tip tax withholding must be between 0 and 1000000 cents' using errcode = '22023';
  end if;

  update public.shifts
    set tip_tax_withheld_cents = p_tip_tax_withheld_cents
    where id = p_shift_id and user_id = v_user_id;
  if not found then
    raise exception 'Shift not found' using errcode = '42501';
  end if;
end;
$$;

revoke execute on function public.set_shift_tip_tax_withheld(uuid, integer) from public, anon, authenticated;
grant execute on function public.set_shift_tip_tax_withheld(uuid, integer) to authenticated;

notify pgrst, 'reload schema';
commit;
