-- Apply manually after the deployed shift-attachments migration. Do not replay that migration.
-- Storage evaluates upload RLS in rollback-only permission probes. A lock taken by the
-- INSERT policy is therefore not held through the final, privileged object insert.
begin;

-- This counter is internal: changing the metadata row makes a concurrent delete that
-- started under REPEATABLE READ/SERIALIZABLE fail with a serialization error instead
-- of relying on a stale snapshot after it waits for the upload to commit.
alter table public.shift_attachments
  add column storage_insert_version bigint not null default 0;

create function public.guard_shift_attachment_storage_insert()
returns trigger
language plpgsql volatile security definer set search_path = ''
as $$
begin
  -- The path is unique and constrained to the attachment's owner, shift, ID, and MIME
  -- extension. This row update takes a lock that lasts through the *actual* Storage
  -- object insert transaction. Permission-probe updates are rolled back with the probe.
  update public.shift_attachments a
  set storage_insert_version = a.storage_insert_version + 1
  where a.storage_path = new.name;

  if not found then
    raise exception 'Photo metadata is no longer available; retry the upload'
      using errcode = '23503';
  end if;

  return new;
end;
$$;
revoke all on function public.guard_shift_attachment_storage_insert()
  from public, anon, authenticated;

-- Scope the Storage-schema hook to this private bucket. Do not replace any other
-- bucket's policies or change Storage object rows directly from an application RPC.
create trigger shift_attachment_storage_insert_guard
  before insert on storage.objects
  for each row when (new.bucket_id = 'shift-attachments')
  execute function public.guard_shift_attachment_storage_insert();

commit;
