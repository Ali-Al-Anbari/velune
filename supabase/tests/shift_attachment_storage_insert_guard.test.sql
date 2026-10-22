-- Run against an isolated database after both shift attachment migrations.
begin;
select plan(10);

select ok(exists (
  select 1 from pg_catalog.pg_attribute
  where attrelid = 'public.shift_attachments'::regclass
    and attname = 'storage_insert_version' and not attisdropped
), 'metadata has a version that invalidates stale deletion snapshots');
select ok(exists (
  select 1 from pg_catalog.pg_trigger
  where tgrelid = 'storage.objects'::regclass
    and tgname = 'shift_attachment_storage_insert_guard' and not tgisinternal
), 'the final Storage object insert has a guard');
select ok(not has_function_privilege('authenticated',
  'public.guard_shift_attachment_storage_insert()', 'EXECUTE'),
  'clients cannot call the privileged guard directly');
select ok(not has_table_privilege('authenticated', 'public.shift_attachments', 'UPDATE'),
  'clients cannot alter the guard version');

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('c3000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'photo-guard@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());
insert into public.shifts (id, user_id, started_at, ended_at)
values ('e3000000-0000-4000-8000-000000000001',
  'c3000000-0000-4000-8000-000000000001', now() - interval '2 hours', now() - interval '1 hour');

select throws_ok($$
  insert into storage.objects (bucket_id, name)
  values ('shift-attachments', 'c3000000-0000-4000-8000-000000000001/e3000000-0000-4000-8000-000000000001/f3000000-0000-4000-8000-000000000002.jpg')
$$, '23503', 'Photo metadata is no longer available; retry the upload',
  'a privileged final insert cannot create an object without metadata');

insert into storage.buckets (id, name, public)
values ('shift-guard-test-other-bucket', 'shift-guard-test-other-bucket', false);
select lives_ok($$
  insert into storage.objects (bucket_id, name)
  values ('shift-guard-test-other-bucket', 'unrelated-object.jpg')
$$, 'the guard does not affect other Storage buckets');

set local request.jwt.claim.sub = 'c3000000-0000-4000-8000-000000000001';
insert into public.shift_attachments
  (id, user_id, shift_id, storage_path, original_filename, mime_type, file_size_bytes)
values ('f3000000-0000-4000-8000-000000000001',
  'c3000000-0000-4000-8000-000000000001',
  'e3000000-0000-4000-8000-000000000001',
  'c3000000-0000-4000-8000-000000000001/e3000000-0000-4000-8000-000000000001/f3000000-0000-4000-8000-000000000001.jpg',
  'photo.jpg', 'image/jpeg', 1000);

select lives_ok($$
  insert into storage.objects (bucket_id, name)
  values ('shift-attachments', 'c3000000-0000-4000-8000-000000000001/e3000000-0000-4000-8000-000000000001/f3000000-0000-4000-8000-000000000001.jpg')
$$, 'an object with matching metadata can be recorded');
select is((select storage_insert_version from public.shift_attachments
  where id = 'f3000000-0000-4000-8000-000000000001'), 1::bigint,
  'the actual object insert changes the metadata row version');

set local role authenticated;
set local request.jwt.claim.sub = 'c3000000-0000-4000-8000-000000000001';
select throws_ok($$select public.delete_shift_attachment('f3000000-0000-4000-8000-000000000001')$$,
  '55000', 'Photo object must be deleted through Storage API first',
  'metadata cannot be deleted while its object exists');
select throws_ok($$
  insert into storage.objects (bucket_id, name)
  values ('shift-attachments', 'c3000000-0000-4000-8000-000000000001/e3000000-0000-4000-8000-000000000001/f3000000-0000-4000-8000-000000000003.jpg')
$$, '23503', 'Photo metadata is no longer available; retry the upload',
  'a caller cannot use the Storage API to insert an orphan');
reset role;

select * from finish();
rollback;
