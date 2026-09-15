-- "Progres saya" on the 3 labeling pages showed only "today" and "total" —
-- adds two more numbers requested by an admin reviewing the tool: the last
-- calendar day (WIB) this labeler actually submitted anything for this
-- jenis (so they can see at a glance whether they worked yesterday, or how
-- long it's been), and their average submissions per active day (total
-- divided by the number of distinct days they've ever been active — not by
-- calendar days since their first submission, which would be skewed by
-- weekends/days off).
--
-- Same SECURITY DEFINER pattern as the rest of this function (labeling_log's
-- only SELECT policy is admin-only, see 20260914110000) and same WIB-local
-- "day" boundary already used for `today`.
create or replace function labeling_my_progress(p_jenis text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_today_start timestamptz;
  v_total bigint;
  v_today bigint;
  v_active_days bigint;
  v_last_active_date date;
  v_avg_per_day numeric;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if p_jenis not in ('screener', 'lapus', 'pengeluaran') then
    raise exception 'jenis tidak valid: %', p_jenis;
  end if;

  v_today_start := date_trunc('day', now() at time zone 'Asia/Jakarta') at time zone 'Asia/Jakarta';

  select count(*) into v_total from labeling_log
  where labeler_id = v_uid and jenis = p_jenis;

  select count(*) into v_today from labeling_log
  where labeler_id = v_uid and jenis = p_jenis and created_at >= v_today_start;

  select
    count(distinct (created_at at time zone 'Asia/Jakarta')::date),
    max((created_at at time zone 'Asia/Jakarta')::date)
  into v_active_days, v_last_active_date
  from labeling_log
  where labeler_id = v_uid and jenis = p_jenis;

  v_avg_per_day := case when v_active_days > 0 then round(v_total::numeric / v_active_days, 1) else 0 end;

  return jsonb_build_object(
    'total', v_total,
    'today', v_today,
    'last_active_date', v_last_active_date,
    'avg_per_day', v_avg_per_day
  );
end;
$$;

revoke all on function labeling_my_progress(text) from public;
grant execute on function labeling_my_progress(text) to authenticated;
