-- Apply manually after review. Shift photos stay private and use caller-authorized Storage API access.
begin;

alter table public.shifts
  add constraint shifts_id_user_id_key unique (id, user_id);

create table public.shift_attachments (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  shift_id uuid not null,
  storage_path text not null unique,
  original_filename text not null,
  mime_type text not null,
  file_size_bytes bigint not null,
  created_at timestamptz not null default now(),
  constraint shift_attachments_shift_owner_fk foreign key (shift_id, user_id)
    references public.shifts (id, user_id) on delete cascade,
  constraint shift_attachments_filename_valid check (char_length(original_filename) between 1 and 255),
  constraint shift_attachments_type_valid check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif')),
  constraint shift_attachments_size_valid check (file_size_bytes between 1 and 12582912),
  constraint shift_attachments_path_valid check (
    storage_path = user_id::text || '/' || shift_id::text || '/' || id::text || '.' ||
      case mime_type
        when 'image/jpeg' then 'jpg'
        when 'image/png' then 'png'
        when 'image/webp' then 'webp'
        when 'image/heic' then 'heic'
        when 'image/heif' then 'heif'
      end
  )
);

create index shift_attachments_owner_shift_created
  on public.shift_attachments (user_id, shift_id, created_at);

create function public.enforce_shift_attachment_limit()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or new.user_id <> auth.uid() then
    raise exception 'Sign in required' using errcode = '42501';
  end if;

  perform s.id from public.shifts s
  where s.id = new.shift_id and s.user_id = new.user_id for update;
  if not found then raise exception 'Shift not found' using errcode = '42501'; end if;

  if (select count(*) from public.shift_attachments a
      where a.shift_id = new.shift_id and a.user_id = new.user_id) >= 20 then
    raise exception 'A shift can have up to 20 photos' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_shift_attachment_limit() from public, anon, authenticated;
create trigger shift_attachments_enforce_limit before insert on public.shift_attachments
  for each row execute function public.enforce_shift_attachment_limit();

alter table public.shift_attachments enable row level security;
revoke all on table public.shift_attachments from public, anon, authenticated;
grant select, insert on table public.shift_attachments to authenticated;

create policy "Read own shift attachments" on public.shift_attachments for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Add attachments to own shifts" on public.shift_attachments for insert to authenticated
  with check (user_id = (select auth.uid()) and exists (
    select 1 from public.shifts s where s.id = shift_id and s.user_id = (select auth.uid())
  ));

-- Supabase Storage API owns the object lifecycle. The database is read only for this schema.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('shift-attachments', 'shift-attachments', false, 12582912,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do update set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Read own shift attachment objects" on storage.objects for select to authenticated
  using (
    bucket_id = 'shift-attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.shift_attachments a
      where a.storage_path = name
        and a.user_id = (select auth.uid())
        and a.shift_id::text = (storage.foldername(name))[2]
    )
  );
create policy "Upload own shift attachment objects" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'shift-attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.shift_attachments a
      where a.storage_path = name
        and a.user_id = (select auth.uid())
        and a.shift_id::text = (storage.foldername(name))[2]
    )
  );
create policy "Delete own shift attachment objects" on storage.objects for delete to authenticated
  using (
    bucket_id = 'shift-attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.shift_attachments a
      where a.storage_path = name
        and a.user_id = (select auth.uid())
        and a.shift_id::text = (storage.foldername(name))[2]
    )
  );

-- Metadata may be removed only after the caller has deleted the object through Storage API.
create function public.delete_shift_attachment(p_attachment_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_attachment public.shift_attachments%rowtype;
begin
  if v_user_id is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  if p_attachment_id is null then raise exception 'Attachment ID is required' using errcode = '22023'; end if;

  select * into v_attachment from public.shift_attachments
  where id = p_attachment_id and user_id = v_user_id for update;
  if not found then raise exception 'Attachment not found' using errcode = '42501'; end if;
  if exists (select 1 from storage.objects o
    where o.bucket_id = 'shift-attachments' and o.name = v_attachment.storage_path) then
    raise exception 'Photo object must be deleted through Storage API first' using errcode = '55000';
  end if;

  delete from public.shift_attachments where id = p_attachment_id and user_id = v_user_id;
end;
$$;
revoke all on function public.delete_shift_attachment(uuid) from public, anon, authenticated;
grant execute on function public.delete_shift_attachment(uuid) to authenticated;

-- Retain the existing caller/owner/active-shift checks and per-user transaction lock.
-- A shift remains intact until every private object has been removed via Storage API.
create or replace function public.delete_completed_shift(p_shift_id uuid)
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
  if exists (select 1 from public.shift_attachments a
    where a.shift_id = p_shift_id and a.user_id = v_user_id) then
    raise exception 'Shift photos must be removed before deleting this shift' using errcode = '55000';
  end if;

  delete from public.shifts
  where id = p_shift_id and user_id = v_user_id and ended_at is not null;
end;
$$;
revoke all on function public.delete_completed_shift(uuid) from public, anon, authenticated;
grant execute on function public.delete_completed_shift(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
