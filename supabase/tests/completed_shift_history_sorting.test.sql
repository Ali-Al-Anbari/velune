begin;
select plan(8);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('c2000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'history-owner@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('c2000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'history-other@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.shifts (id, user_id, started_at, ended_at, hourly_wage_cents_snapshot)
values
  ('e2000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', '2026-10-10 12:00:00+00', '2026-10-10 15:00:00+00', 2500),
  ('e2000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-000000000001', '2026-10-09 23:00:00+00', '2026-10-10 02:30:00+00', 2500),
  ('e2000000-0000-4000-8000-000000000003', 'c2000000-0000-4000-8000-000000000001', '2026-10-10 09:00:00+00', '2026-10-10 12:30:00+00', null),
  ('e2000000-0000-4000-8000-000000000004', 'c2000000-0000-4000-8000-000000000002', '2026-10-10 08:00:00+00', '2026-10-10 20:00:00+00', 9900);

insert into public.breaks (id, shift_id, started_at, ended_at, is_paid)
values
  ('a2000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', '2026-10-10 12:30:00+00', '2026-10-10 13:00:00+00', false),
  ('a2000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000002', '2026-10-10 00:00:00+00', '2026-10-10 00:30:00+00', true);

insert into public.tips (id, shift_id, amount_cents, label)
values
  ('a2000000-0000-4000-8000-000000000011', 'e2000000-0000-4000-8000-000000000001', 500, 'Cash'),
  ('a2000000-0000-4000-8000-000000000012', 'e2000000-0000-4000-8000-000000000002', 400, 'Cash'),
  ('a2000000-0000-4000-8000-000000000013', 'e2000000-0000-4000-8000-000000000002', 600, 'Card'),
  ('a2000000-0000-4000-8000-000000000014', 'e2000000-0000-4000-8000-000000000003', 1000, 'Other'),
  ('a2000000-0000-4000-8000-000000000015', 'e2000000-0000-4000-8000-000000000004', 9900, 'Cash');

set local role authenticated;
set local request.jwt.claim.sub = 'c2000000-0000-4000-8000-000000000001';

select is(
  (select array_agg(shift_id order by ordinal) from public.completed_shift_history_page(p_sort => 'longest') with ordinality as page(shift_id, started_at, sort_value, ordinal)),
  array['e2000000-0000-4000-8000-000000000003'::uuid, 'e2000000-0000-4000-8000-000000000002'::uuid, 'e2000000-0000-4000-8000-000000000001'::uuid],
  'longest sort counts paid breaks and excludes unpaid breaks, with newest tie first'
);
select is(
  (select array_agg(shift_id order by ordinal) from public.completed_shift_history_page(p_sort => 'tips') with ordinality as page(shift_id, started_at, sort_value, ordinal)),
  array['e2000000-0000-4000-8000-000000000003'::uuid, 'e2000000-0000-4000-8000-000000000002'::uuid, 'e2000000-0000-4000-8000-000000000001'::uuid],
  'tip sort aggregates all gross tip entries and breaks ties by newest shift'
);
select is(
  (select array_agg(shift_id order by ordinal) from public.completed_shift_history_page(p_sort => 'hourly_rate') with ordinality as page(shift_id, started_at, sort_value, ordinal)),
  array['e2000000-0000-4000-8000-000000000001'::uuid, 'e2000000-0000-4000-8000-000000000002'::uuid, 'e2000000-0000-4000-8000-000000000003'::uuid],
  'saved effective wage ties use newest shift first and missing wages sort last'
);
select is(
  (select array_agg(shift_id order by ordinal) from public.completed_shift_history_page(
    p_sort => 'longest', p_cursor_started_at => '2026-10-10 09:00:00+00',
    p_cursor_id => 'e2000000-0000-4000-8000-000000000003', p_cursor_value => 12600000
  ) with ordinality as page(shift_id, started_at, sort_value, ordinal)),
  array['e2000000-0000-4000-8000-000000000002'::uuid, 'e2000000-0000-4000-8000-000000000001'::uuid],
  'aggregate cursor continues after the 3.5 hour tie without duplication'
);
select is(
  (select count(*)::integer from public.completed_shift_history_page(p_with_tips_only => true, p_search => '2026-10-10', p_search_started_at => '2026-10-10 00:00:00+00', p_search_ended_before => '2026-10-11 00:00:00+00')),
  2,
  'search and tips filters apply before limiting the complete matching dataset'
);
select ok(has_function_privilege('authenticated', 'public.completed_shift_history_page(timestamptz,timestamptz,uuid,boolean,boolean,boolean,text,uuid,timestamptz,timestamptz,text,timestamptz,uuid,bigint)', 'EXECUTE'), 'authenticated users can call the history query');
select ok(not has_function_privilege('anon', 'public.completed_shift_history_page(timestamptz,timestamptz,uuid,boolean,boolean,boolean,text,uuid,timestamptz,timestamptz,text,timestamptz,uuid,bigint)', 'EXECUTE'), 'anonymous users cannot call the history query');

reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'c2000000-0000-4000-8000-000000000002';
select is(
  (select array_agg(shift_id order by ordinal) from public.completed_shift_history_page() with ordinality as page(shift_id, started_at, sort_value, ordinal)),
  array['e2000000-0000-4000-8000-000000000004'::uuid],
  'the invoker sees only shifts belonging to the authenticated user'
);

reset role;
select * from finish();
rollback;
