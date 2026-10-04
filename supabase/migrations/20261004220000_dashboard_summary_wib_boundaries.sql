-- Follow-up to the publication_datetime backfill (20261004200000) -- same
-- reasoning as 20261004210000. Two things needed fixing here, not one:
-- 1) p_date_from/p_date_to (the dashboard's date-range picker, plain
--    <input type="date"> values) need the same WIB-literal conversion as
--    labeling_sprint_q3_2026_progress()/claim_next_news_for_labeling().
-- 2) monthly_agg's `to_char(publication_datetime, 'YYYY-MM')` bucketing (the
--    dashboard's "per bulan" chart) formats a timestamptz using the DB
--    session's default timezone (UTC) -- previously harmless by the same
--    pre-backfill coincidence, now needs an explicit
--    `publication_datetime at time zone 'Asia/Jakarta'` conversion first so an
--    article published in the first ~7 WIB hours of a month doesn't get bucketed
--    into the previous month.
create or replace function dashboard_summary(
  p_date_from date default null,
  p_date_to date default null,
  p_region text default null,
  p_pdrb_only boolean default false
)
returns jsonb
language sql
stable
as $$
  with base as (
    select *
    from news
    where (p_date_from is null or publication_datetime >= (p_date_from::timestamp at time zone 'Asia/Jakarta'))
      and (p_date_to   is null or publication_datetime < ((p_date_to + 1)::timestamp at time zone 'Asia/Jakarta'))
      and (p_region    is null or region_final = p_region)
      and (
        not p_pdrb_only
        or lu_relevan = 'Ya' or pengeluaran_relevan = 'Ya'
      )
  ),
  totals as (
    select
      count(*)::int as total,
      count(*) filter (where lu_relevan = 'Ya' or pengeluaran_relevan = 'Ya')::int as pdrb,
      count(*) filter (where lu_relevan = 'Ya')::int as lu_relevan_count,
      count(*) filter (where pengeluaran_relevan = 'Ya')::int as pengeluaran_relevan_count
    from base
  ),
  lapus_agg as (
    select code, count(*)::int as n
    from base, unnest(kategori_lapus) as code
    group by code
  ),
  peng_agg as (
    select code, count(*)::int as n
    from base, unnest(komponen_pengeluaran) as code
    group by code
  ),
  wilayah_agg as (
    select region_final as region, count(*)::int as n
    from base
    where region_final is not null
    group by region_final
  ),
  status_agg as (
    select coalesce(event_time, 'Tidak Disebutkan') as status, count(*)::int as n
    from base
    group by coalesce(event_time, 'Tidak Disebutkan')
  ),
  monthly_agg as (
    select
      to_char(publication_datetime at time zone 'Asia/Jakarta', 'YYYY-MM') as ym,
      count(*)::int as total,
      count(*) filter (where lu_relevan = 'Ya' or pengeluaran_relevan = 'Ya')::int as relevant
    from base
    where publication_datetime is not null
    group by to_char(publication_datetime at time zone 'Asia/Jakarta', 'YYYY-MM')
  )
  select jsonb_build_object(
    'total', (select total from totals),
    'pdrb', (select pdrb from totals),
    'lu_relevan_count', (select lu_relevan_count from totals),
    'pengeluaran_relevan_count', (select pengeluaran_relevan_count from totals),
    'lapus', (select coalesce(jsonb_object_agg(code, n), '{}'::jsonb) from lapus_agg),
    'pengeluaran', (select coalesce(jsonb_object_agg(code, n), '{}'::jsonb) from peng_agg),
    'wilayah', (select coalesce(jsonb_object_agg(region, n), '{}'::jsonb) from wilayah_agg),
    'status', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from status_agg),
    'monthly', (select coalesce(jsonb_object_agg(ym, jsonb_build_object('total', total, 'relevant', relevant)), '{}'::jsonb) from monthly_agg)
  );
$$;
