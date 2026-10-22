-- Server-side completed shift filtering and sorting so computed sort modes are
-- applied to the full owner-scoped result set before cursor pagination.
-- Apply manually after review.
begin;

create function public.completed_shift_history_page(
  p_started_at timestamptz default null,
  p_ended_before timestamptz default null,
  p_wage_profile_id uuid default null,
  p_no_profile boolean default false,
  p_with_tips_only boolean default false,
  p_missing_wage_only boolean default false,
  p_search text default null,
  p_search_id uuid default null,
  p_search_started_at timestamptz default null,
  p_search_ended_before timestamptz default null,
  p_sort text default 'newest',
  p_cursor_started_at timestamptz default null,
  p_cursor_id uuid default null,
  p_cursor_value bigint default null
)
returns table (shift_id uuid, started_at timestamptz, sort_value bigint)
language sql stable security invoker set search_path = ''
as $$
  with filtered as (
    select s.id, s.started_at, s.ended_at, s.hourly_wage_cents_snapshot,
      coalesce(b.unpaid_break_ms, 0) as unpaid_break_ms,
      coalesce(t.tip_total_cents, 0) as tip_total_cents,
      case p_sort
        when 'longest' then (
          pg_catalog.floor(extract(epoch from s.ended_at) * 1000)::bigint
          - pg_catalog.floor(extract(epoch from s.started_at) * 1000)::bigint
        ) - coalesce(b.unpaid_break_ms, 0)
        when 'tips' then coalesce(t.tip_total_cents, 0)
        when 'hourly_rate' then s.hourly_wage_cents_snapshot::bigint
        else null
      end as computed_sort_value
    from public.shifts s
    left join lateral (
      select pg_catalog.sum(pg_catalog.floor(
        extract(epoch from least(s.ended_at, br.ended_at)) * 1000
        - extract(epoch from greatest(s.started_at, br.started_at)) * 1000
      )::bigint) filter (where not br.is_paid) as unpaid_break_ms
      from public.breaks br
      where br.shift_id = s.id and br.ended_at is not null
    ) b on true
    left join lateral (
      select pg_catalog.sum(tp.amount_cents)::bigint as tip_total_cents
      from public.tips tp where tp.shift_id = s.id
    ) t on true
    where s.user_id = auth.uid()
      and s.ended_at is not null
      and (p_started_at is null or s.started_at >= p_started_at)
      and (p_ended_before is null or s.started_at < p_ended_before)
      and (p_no_profile is false or s.wage_profile_id is null)
      and (p_wage_profile_id is null or s.wage_profile_id = p_wage_profile_id)
      and (p_missing_wage_only is false or s.hourly_wage_cents_snapshot is null)
      and (p_with_tips_only is false or exists (
        select 1 from public.tips tip_filter where tip_filter.shift_id = s.id
      ))
      and (
        nullif(pg_catalog.btrim(p_search), '') is null
        or s.wage_profile_name_snapshot ilike ('%' || pg_catalog.btrim(p_search) || '%')
        or (p_search_id is not null and s.id = p_search_id)
        or (p_search_started_at is not null and s.started_at >= p_search_started_at
          and s.started_at < p_search_ended_before)
      )
  )
  select f.id, f.started_at, f.computed_sort_value
  from filtered f
  where p_cursor_started_at is null or p_cursor_id is null or (
    case p_sort
      when 'oldest' then (f.started_at, f.id) > (p_cursor_started_at, p_cursor_id)
      when 'longest' then f.computed_sort_value < p_cursor_value
        or (f.computed_sort_value = p_cursor_value and (f.started_at, f.id) < (p_cursor_started_at, p_cursor_id))
      when 'tips' then f.computed_sort_value < p_cursor_value
        or (f.computed_sort_value = p_cursor_value and (f.started_at, f.id) < (p_cursor_started_at, p_cursor_id))
      when 'hourly_rate' then
        (p_cursor_value is null and f.computed_sort_value is null
          and (f.started_at, f.id) < (p_cursor_started_at, p_cursor_id))
        or (p_cursor_value is not null and (
          f.computed_sort_value is null
          or f.computed_sort_value < p_cursor_value
          or (f.computed_sort_value = p_cursor_value and (f.started_at, f.id) < (p_cursor_started_at, p_cursor_id))
        ))
      else (f.started_at, f.id) < (p_cursor_started_at, p_cursor_id)
    end
  )
  order by
    case when p_sort = 'hourly_rate' and f.computed_sort_value is null then 1 else 0 end,
    case when p_sort in ('longest', 'tips', 'hourly_rate') then f.computed_sort_value end desc,
    case when p_sort = 'oldest' then f.started_at end asc,
    case when p_sort = 'oldest' then f.id end asc,
    case when p_sort <> 'oldest' then f.started_at end desc,
    case when p_sort <> 'oldest' then f.id end desc
  limit 21;
$$;

revoke all on function public.completed_shift_history_page(
  timestamptz, timestamptz, uuid, boolean, boolean, boolean, text, uuid,
  timestamptz, timestamptz, text, timestamptz, uuid, bigint
) from public, anon, authenticated;
grant execute on function public.completed_shift_history_page(
  timestamptz, timestamptz, uuid, boolean, boolean, boolean, text, uuid,
  timestamptz, timestamptz, text, timestamptz, uuid, bigint
) to authenticated;

notify pgrst, 'reload schema';
commit;
