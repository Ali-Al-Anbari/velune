begin;
select plan(10);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'withholding-owner@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('a0000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'withholding-other@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.shifts (id, user_id, started_at, ended_at)
values
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', '2026-10-20 09:00:00+00', '2026-10-20 17:00:00+00'),
  ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', '2026-10-21 09:00:00+00', null),
  ('b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000002', '2026-10-20 09:00:00+00', '2026-10-20 17:00:00+00');

set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-4000-8000-000000000001';

select lives_ok(
  $$select public.set_shift_tip_tax_withheld('b0000000-0000-4000-8000-000000000001', 1234)$$,
  'owner can set withholding on a completed shift'
);
select is(
  (select tip_tax_withheld_cents from public.shifts where id = 'b0000000-0000-4000-8000-000000000001'),
  1234,
  'withholding is persisted as integer cents'
);
select lives_ok(
  $$select public.set_shift_tip_tax_withheld('b0000000-0000-4000-8000-000000000002', 50)$$,
  'owner can set withholding on an active shift'
);
select is(
  (select tip_tax_withheld_cents from public.shifts where id = 'b0000000-0000-4000-8000-000000000002'),
  50,
  'active shift amount is stored'
);
select throws_ok(
  $$select public.set_shift_tip_tax_withheld('b0000000-0000-4000-8000-000000000003', 100)$$,
  '42501', 'Shift not found', 'owner cannot change another user’s shift'
);
select throws_ok(
  $$select public.set_shift_tip_tax_withheld('b0000000-0000-4000-8000-000000000001', -1)$$,
  '22023', 'Tip tax withholding must be between 0 and 1000000 cents', 'negative amounts are rejected'
);
select lives_ok(
  $$select public.set_shift_tip_tax_withheld('b0000000-0000-4000-8000-000000000001', 0)$$,
  'explicit zero is accepted'
);
select is(
  (select tip_tax_withheld_cents from public.shifts where id = 'b0000000-0000-4000-8000-000000000001'),
  0,
  'explicit zero remains distinguishable from no amount'
);
select lives_ok(
  $$select public.set_shift_tip_tax_withheld('b0000000-0000-4000-8000-000000000001', null)$$,
  'owner can clear withholding'
);
select is(
  (select tip_tax_withheld_cents from public.shifts where id = 'b0000000-0000-4000-8000-000000000001'),
  null::integer,
  'cleared amount returns to not entered'
);

reset role;
select * from finish();
rollback;
