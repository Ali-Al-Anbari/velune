begin;
select plan(9);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('c1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'delete-owner@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('c1000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'delete-other@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.shifts (id, user_id, started_at, ended_at)
values
  ('e1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', now() - interval '4 hours', now() - interval '3 hours'),
  ('e1000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000001', now() - interval '1 hour', null),
  ('e1000000-0000-4000-8000-000000000003', 'c1000000-0000-4000-8000-000000000002', now() - interval '4 hours', now() - interval '3 hours');
insert into public.breaks (id, shift_id, started_at, ended_at, is_paid)
values ('a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', now() - interval '3 hours 45 minutes', now() - interval '3 hours 30 minutes', false);
insert into public.tips (id, shift_id, amount_cents, label)
values ('a1000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000001', 500, 'Cash');

select ok(not has_table_privilege('authenticated', 'public.shifts', 'DELETE'), 'authenticated users cannot directly delete shifts');
select ok(has_function_privilege('authenticated', 'public.delete_completed_shift(uuid)', 'EXECUTE'), 'authenticated users can call the scoped deletion RPC');

set local role authenticated;
set local request.jwt.claim.sub = 'c1000000-0000-4000-8000-000000000001';
select lives_ok($$select public.delete_completed_shift('e1000000-0000-4000-8000-000000000001')$$, 'owner can delete a completed shift');
select ok(not exists (select 1 from public.shifts where id = 'e1000000-0000-4000-8000-000000000001'), 'the selected shift is deleted');
select is((select count(*)::integer from public.breaks where id = 'a1000000-0000-4000-8000-000000000001'), 0, 'shift deletion cascades to its breaks');
select is((select count(*)::integer from public.tips where id = 'a1000000-0000-4000-8000-000000000002'), 0, 'shift deletion cascades to its tips');
select throws_ok($$select public.delete_completed_shift('e1000000-0000-4000-8000-000000000002')$$, '22023', 'Active shifts cannot be deleted', 'active shifts cannot be deleted');

reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'c1000000-0000-4000-8000-000000000002';
select throws_ok($$select public.delete_completed_shift('e1000000-0000-4000-8000-000000000003')$$, '42501', 'Completed shift not found', 'another user cannot delete this shift');
reset role;
select is((select count(*)::integer from public.shifts where id = 'e1000000-0000-4000-8000-000000000003'), 1, 'unauthorized deletion leaves the other shift untouched');

select * from finish();
rollback;
