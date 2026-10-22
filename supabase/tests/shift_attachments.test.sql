begin;
select plan(21);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('c2000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'photo-owner@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('c2000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'photo-other@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.shifts (id, user_id, started_at, ended_at)
values
  ('e2000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', now() - interval '4 hours', now() - interval '3 hours'),
  ('e2000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-000000000002', now() - interval '4 hours', now() - interval '3 hours');
insert into public.breaks (id, shift_id, started_at, ended_at, is_paid)
values ('a2000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', now() - interval '3 hours 45 minutes', now() - interval '3 hours 30 minutes', false);
insert into public.tips (id, shift_id, amount_cents, label)
values ('a2000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000001', 500, 'Cash');

select is((select public from storage.buckets where id = 'shift-attachments'), false, 'attachment bucket is private');
select is((select file_size_limit from storage.buckets where id = 'shift-attachments'), 12582912::bigint, 'Storage enforces the 12 MB attachment limit');
select is((select allowed_mime_types from storage.buckets where id = 'shift-attachments'), array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']::text[], 'Storage allows only supported image types');
select ok((select relrowsecurity from pg_class where oid = 'public.shift_attachments'::regclass), 'attachment metadata has RLS enabled');
select ok(not has_table_privilege('authenticated', 'public.shift_attachments', 'DELETE'), 'clients cannot delete metadata before the Storage API object');
select ok(exists (select 1 from pg_catalog.pg_trigger where tgrelid = 'public.shift_attachments'::regclass and tgname = 'shift_attachments_enforce_limit' and not tgisinternal), 'database enforces the per-shift photo limit');
select ok(has_function_privilege('authenticated', 'public.delete_shift_attachment(uuid)', 'EXECUTE'), 'authenticated users can call owner-scoped metadata cleanup');
select ok(exists (select 1 from pg_catalog.pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'Upload own shift attachment objects'), 'Storage upload policy exists');
select ok(exists (select 1 from pg_catalog.pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'Read own shift attachment objects'), 'Storage read policy exists');
select ok(exists (select 1 from pg_catalog.pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'Delete own shift attachment objects'), 'Storage delete policy exists');

set local role authenticated;
set local request.jwt.claim.sub = 'c2000000-0000-4000-8000-000000000001';
select lives_ok($$insert into public.shift_attachments (id, user_id, shift_id, storage_path, original_filename, mime_type, file_size_bytes)
  values ('f2000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001',
    'c2000000-0000-4000-8000-000000000001/e2000000-0000-4000-8000-000000000001/f2000000-0000-4000-8000-000000000001.jpg', 'receipt.jpg', 'image/jpeg', 1200)$$,
  'owner can add an image attachment to a shift');
select is((select count(*)::integer from public.shift_attachments where shift_id = 'e2000000-0000-4000-8000-000000000001'), 1, 'owner can read own attachment metadata');
select throws_ok($$insert into public.shift_attachments (id, user_id, shift_id, storage_path, original_filename, mime_type, file_size_bytes)
  values ('f2000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000002',
    'c2000000-0000-4000-8000-000000000001/e2000000-0000-4000-8000-000000000002/f2000000-0000-4000-8000-000000000002.jpg', 'other.jpg', 'image/jpeg', 1200)$$,
  '42501', 'caller cannot attach a photo to another user shift');
select throws_ok($$delete from public.shift_attachments where id = 'f2000000-0000-4000-8000-000000000001'$$, '42501', 'metadata cannot be deleted directly');
select throws_ok($$select public.delete_completed_shift('e2000000-0000-4000-8000-000000000001')$$,
  '55000', 'Shift photos must be removed before deleting this shift', 'shift deletion is blocked until attachment object cleanup completes');
select lives_ok($$select public.delete_shift_attachment('f2000000-0000-4000-8000-000000000001')$$, 'owner can remove metadata after the Storage object is absent');
select lives_ok($$select public.delete_completed_shift('e2000000-0000-4000-8000-000000000001')$$, 'owner can delete the shift after photo cleanup');
select is((select count(*)::integer from public.breaks where id = 'a2000000-0000-4000-8000-000000000001'), 0, 'shift delete still cascades to breaks');
select is((select count(*)::integer from public.tips where id = 'a2000000-0000-4000-8000-000000000002'), 0, 'shift delete still cascades to tips');

reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'c2000000-0000-4000-8000-000000000002';
select is((select count(*)::integer from public.shift_attachments), 0, 'other user cannot read owner attachment metadata');
select throws_ok($$select public.delete_shift_attachment('f2000000-0000-4000-8000-000000000001')$$, '42501', 'other user cannot delete attachment metadata');
reset role;
select * from finish();
rollback;
