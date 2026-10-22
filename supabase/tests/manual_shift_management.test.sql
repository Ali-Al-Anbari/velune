begin;
select plan(36);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('c0000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'manual-owner@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('c0000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'manual-other@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.wage_profiles (id, user_id, name, hourly_wage_cents, normally_tipped)
values
  ('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'Original', 1850, true),
  ('d0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', 'Current', 2200, false);

set local role authenticated;
set local request.jwt.claim.sub = 'c0000000-0000-4000-8000-000000000001';
select ok(not has_table_privilege('authenticated', 'public.shifts', 'INSERT'), 'authenticated users retain no direct shift insert grant');
select ok(not has_table_privilege('authenticated', 'public.shifts', 'UPDATE'), 'authenticated users retain no direct shift update grant');
select ok(not has_function_privilege('authenticated', 'public.validate_manual_shift_breaks(jsonb,timestamp with time zone,timestamp with time zone,uuid)', 'EXECUTE'), 'break validation helper is not callable by clients');

select lives_ok($$select public.create_manual_shift(
  'e0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001',
  now() - interval '10 hours', now() - interval '2 hours',
  'd0000000-0000-4000-8000-000000000001', 2025,
  ('[{"id":"a0000000-0000-4000-8000-000000000011","started_at":"' ||
    (now() - interval '6 hours')::text || '","ended_at":"' ||
    (now() - interval '5 hours 45 minutes')::text || '","is_paid":false}]')::jsonb
)$$, 'owner creates a completed shift with an unpaid break and override');
select is((select hourly_wage_cents_snapshot from public.shifts where id = 'e0000000-0000-4000-8000-000000000001'), 2025, 'override is saved as the effective wage snapshot');
select is((select wage_profile_name_snapshot from public.shifts where id = 'e0000000-0000-4000-8000-000000000001'), 'Original', 'profile name is snapshotted');
select is((select count(*)::integer from public.breaks where shift_id = 'e0000000-0000-4000-8000-000000000001'), 1, 'break is created atomically');
select is((select is_paid from public.breaks where id = 'a0000000-0000-4000-8000-000000000011'), false, 'new unpaid break remains unpaid');

select lives_ok($$select public.create_manual_shift(
  'e0000000-0000-4000-8000-000000000099', 'f0000000-0000-4000-8000-000000000001',
  now() - interval '9 hours', now() - interval '1 hour', null, null, '[]'::jsonb
)$$, 'retrying a create request returns its original shift');
select is((select count(*)::integer from public.shifts where manual_creation_request_id = 'f0000000-0000-4000-8000-000000000001'), 1, 'create retry does not duplicate the shift');
select is((select started_at from public.shifts where id = 'e0000000-0000-4000-8000-000000000001'), (now() - interval '10 hours')::timestamptz, 'create retry does not change original timestamps');

insert into public.tips (id, shift_id, amount_cents, label)
values ('a0000000-0000-4000-8000-000000000021', 'e0000000-0000-4000-8000-000000000001', 3250, 'Cash');
select public.set_shift_tip_tax_withheld('e0000000-0000-4000-8000-000000000001', 250);
update public.wage_profiles set hourly_wage_cents = 2500, name = 'Renamed original'
where id = 'd0000000-0000-4000-8000-000000000001';

select lives_ok($$select public.update_completed_shift(
  'e0000000-0000-4000-8000-000000000001', 0,
  now() - interval '9 hours 30 minutes', now() - interval '1 hour 30 minutes',
  'd0000000-0000-4000-8000-000000000001', 2025,
  ('[{"id":"a0000000-0000-4000-8000-000000000011","started_at":"' ||
    (now() - interval '6 hours')::text || '","ended_at":"' ||
    (now() - interval '5 hours 45 minutes')::text || '","is_paid":false}]')::jsonb
)$$, 'editing times succeeds atomically');
select is((select wage_profile_name_snapshot from public.shifts where id = 'e0000000-0000-4000-8000-000000000001'), 'Original', 'time-only edit preserves the old profile snapshot');
select is((select hourly_wage_cents_snapshot from public.shifts where id = 'e0000000-0000-4000-8000-000000000001'), 2025, 'time-only edit preserves the wage snapshot');
select is((select manual_edit_version from public.shifts where id = 'e0000000-0000-4000-8000-000000000001'), 1, 'successful update increments the edit version');
select is((select count(*)::integer from public.shifts where id = 'e0000000-0000-4000-8000-000000000001'), 1, 'completed-shift edit updates the original row without creating another shift');
select is((select amount_cents from public.tips where id = 'a0000000-0000-4000-8000-000000000021'), 3250, 'editing a shift preserves individual tips');
select is((select tip_tax_withheld_cents from public.shifts where id = 'e0000000-0000-4000-8000-000000000001'), 250, 'editing a shift preserves tip withholding');

select lives_ok($$select public.create_manual_shift(
  'e0000000-0000-4000-8000-000000000008', 'f0000000-0000-4000-8000-000000000008',
  '2024-05-01 09:00:00+00', '2024-05-01 17:00:00+00', null, null, '[]'::jsonb
)$$, 'manual creation accepts a shift with no breaks');
select is((select count(*)::integer from public.breaks where shift_id = 'e0000000-0000-4000-8000-000000000008'), 0, 'manual shift can persist with zero breaks');

select lives_ok($$select public.update_completed_shift(
  'e0000000-0000-4000-8000-000000000001', 1,
  now() - interval '9 hours 30 minutes', now() - interval '1 hour 30 minutes',
  'd0000000-0000-4000-8000-000000000002', null,
  ('[{"id":"a0000000-0000-4000-8000-000000000011","started_at":"' ||
    (now() - interval '6 hours')::text || '","ended_at":"' ||
    (now() - interval '5 hours 45 minutes')::text || '","is_paid":false}]')::jsonb
)$$, 'changing to another active profile succeeds');
select is((select wage_profile_name_snapshot from public.shifts where id = 'e0000000-0000-4000-8000-000000000001'), 'Current', 'profile change captures the current name');
select is((select hourly_wage_cents_snapshot from public.shifts where id = 'e0000000-0000-4000-8000-000000000001'), 2200, 'profile change captures current hourly wage');
select is((select count(*)::integer from public.breaks where shift_id = 'e0000000-0000-4000-8000-000000000001'), 1, 'profile changes preserve the submitted break list');

select throws_ok($$select public.update_completed_shift(
  'e0000000-0000-4000-8000-000000000001', 1,
  now() - interval '9 hours 30 minutes', now() - interval '1 hour 30 minutes',
  'd0000000-0000-4000-8000-000000000002', null, '[]'::jsonb
)$$, '40001', 'This shift changed elsewhere. Reload before editing again.', 'stale concurrent edits are rejected');
select throws_ok($$select public.create_manual_shift(
  'e0000000-0000-4000-8000-000000000003', 'f0000000-0000-4000-8000-000000000003',
  now() - interval '9 hours', now() - interval '8 hours', null, null, '[]'::jsonb
)$$, '23P01', 'This time overlaps another shift', 'overlapping shifts are rejected');
select throws_ok($$select public.create_manual_shift(
  'e0000000-0000-4000-8000-000000000009', 'f0000000-0000-4000-8000-000000000009',
  now() - interval '2 hours', now() - interval '3 hours', null, null, '[]'::jsonb
)$$, '22023', 'Shift start must be earlier than shift end', 'reversed shift times are rejected');
select throws_ok($$select public.create_manual_shift(
  'e0000000-0000-4000-8000-000000000010', 'f0000000-0000-4000-8000-000000000010',
  now() - interval '48 hours', now() - interval '23 hours', null, null, '[]'::jsonb
)$$, '22023', 'A shift cannot be longer than 24 hours', 'shifts longer than 24 hours are rejected');
select throws_ok($$select public.create_manual_shift(
  'e0000000-0000-4000-8000-000000000012', 'f0000000-0000-4000-8000-000000000012',
  '2024-05-02 10:00:00+00', '2024-05-02 11:00:00+00', null, null,
  '[{"id":"a0000000-0000-4000-8000-000000000041","started_at":"2024-05-02 09:30:00+00","ended_at":"2024-05-02 10:30:00+00","is_paid":true}]'::jsonb
)$$, '22023', 'Breaks must fall within shift boundaries', 'breaks outside shift bounds are rejected');
select throws_ok($$select public.update_completed_shift(
  'e0000000-0000-4000-8000-000000000001', 2,
  now() - interval '9 hours 30 minutes', now() - interval '1 hour 30 minutes',
  'd0000000-0000-4000-8000-000000000002', null,
  ('[{"id":"a0000000-0000-4000-8000-000000000031","started_at":"' ||
    (now() - interval '6 hours')::text || '","ended_at":"' ||
    (now() - interval '5 hours')::text || '","is_paid":false},' ||
   '{"id":"a0000000-0000-4000-8000-000000000032","started_at":"' ||
    (now() - interval '5 hours 30 minutes')::text || '","ended_at":"' ||
    (now() - interval '5 hours 15 minutes')::text || '","is_paid":true}]')::jsonb
)$$, '22023', 'Breaks cannot overlap', 'overlapping breaks are rejected');

reset role;
insert into public.shifts (id, user_id, started_at)
values ('e0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002', now() - interval '2 hours');
insert into public.shifts (id, user_id, started_at, ended_at)
values ('e0000000-0000-4000-8000-000000000007', 'c0000000-0000-4000-8000-000000000002', now() - interval '8 hours', now() - interval '7 hours');
set local role authenticated;
set local request.jwt.claim.sub = 'c0000000-0000-4000-8000-000000000002';
select throws_ok($$select public.update_completed_shift(
  'e0000000-0000-4000-8000-000000000001', 2,
  now() - interval '9 hours 30 minutes', now() - interval '1 hour 30 minutes', null, null, '[]'::jsonb
)$$, '42501', 'Completed shift not found', 'guessed IDs cannot edit another user shift');
select throws_ok($$select public.update_completed_shift(
  'e0000000-0000-4000-8000-000000000007', 0,
  now() - interval '8 hours', now() - interval '7 hours', null, null,
  ('[{"id":"a0000000-0000-4000-8000-000000000011","started_at":"' ||
    (now() - interval '7 hours 45 minutes')::text || '","ended_at":"' ||
    (now() - interval '7 hours 30 minutes')::text || '","is_paid":false}]')::jsonb
)$$, '42501', 'Break not found', 'users cannot attach another shift’s break ID');
select throws_ok($$select public.create_manual_shift(
  'e0000000-0000-4000-8000-000000000004', 'f0000000-0000-4000-8000-000000000004',
  now() - interval '4 hours', now() - interval '3 hours',
  'd0000000-0000-4000-8000-000000000001', null, '[]'::jsonb
)$$, '42501', 'Wage profile not found', 'users cannot attach another owner’s profile');
select throws_ok($$select public.create_manual_shift(
  'e0000000-0000-4000-8000-000000000005', 'f0000000-0000-4000-8000-000000000005',
  now() - interval '90 minutes', now() - interval '30 minutes', null, null, '[]'::jsonb
)$$, '23P01', 'This time overlaps another shift', 'manual shifts cannot overlap an active shift');

reset role;
set local timezone = 'America/New_York';
set local role authenticated;
set local request.jwt.claim.sub = 'c0000000-0000-4000-8000-000000000001';
select lives_ok($$select public.create_manual_shift(
  'e0000000-0000-4000-8000-000000000006', 'f0000000-0000-4000-8000-000000000006',
  '2026-03-08 01:30:00-05', '2026-03-08 03:30:00-04', null, null, '[]'::jsonb
)$$, 'spring daylight-saving shift uses real instants');
select is((select extract(epoch from ended_at - started_at)::integer from public.shifts where id = 'e0000000-0000-4000-8000-000000000006'), 3600, 'spring clock jump duration is one actual hour');

reset role;
select * from finish();
rollback;
