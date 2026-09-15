-- "Progres saya" showed last_active_date/avg_per_day (20260915110000) but not
-- how many labels were submitted on that last active day, nor how many
-- active days avg_per_day was actually divided by — both needed so the
-- displayed average is verifiable at a glance instead of a number an admin
-- has to trust blindly. Both come free from data already being computed in
-- this function (active_days was already counted to produce avg_per_day;
-- last_active_count is one more count(*) scoped to v_last_active_date).
-- Signature unchanged, so `create or replace` is safe here.
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
  v_last_active_count bigint;
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

  if v_last_active_date is not null then
    select count(*) into v_last_active_count from labeling_log
    where labeler_id = v_uid and jenis = p_jenis
      and (created_at at time zone 'Asia/Jakarta')::date = v_last_active_date;
  else
    v_last_active_count := 0;
  end if;

  return jsonb_build_object(
    'total', v_total,
    'today', v_today,
    'last_active_date', v_last_active_date,
    'last_active_count', v_last_active_count,
    'active_days', v_active_days,
    'avg_per_day', v_avg_per_day
  );
end;
$$;

revoke all on function labeling_my_progress(text) from public;
grant execute on function labeling_my_progress(text) to authenticated;
