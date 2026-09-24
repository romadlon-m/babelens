-- Perf fix (2026-09-24): dashboard.js used to fetch every raw `news` row
-- matching the active date/region/PDRB filter (7 columns, no LIMIT) and
-- aggregate everything client-side in JS. Measured against production: the
-- default view alone shipped ~4.3MB of JSON to the browser, for both
-- logged-in and anonymous visitors, and grows daily as `news` grows.
--
-- This RPC computes every aggregate the dashboard needs (totals, per-lapus,
-- per-komponen-pengeluaran, per-wilayah, per-bulan, per-status) in one SQL
-- pass and returns a small jsonb summary instead. Plain (non-SECURITY
-- DEFINER) function: anon can already SELECT `news` directly (the
-- pre-login public dashboard depends on this), so it runs fine with
-- invoker rights and needs no elevated privileges.
create or replace function public.dashboard_summary(
  p_date_from date default null,
  p_date_to   date default null,
  p_region    text default null,
  p_pdrb_only boolean default false
)
returns jsonb
language sql
stable
as $$
  with base as (
    select *
    from news
    where (p_date_from is null or publication_datetime >= p_date_from)
      and (p_date_to   is null or publication_datetime < (p_date_to + 1))
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
      to_char(publication_datetime, 'YYYY-MM') as ym,
      count(*)::int as total,
      count(*) filter (where lu_relevan = 'Ya' or pengeluaran_relevan = 'Ya')::int as relevant
    from base
    where publication_datetime is not null
    group by to_char(publication_datetime, 'YYYY-MM')
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

grant execute on function public.dashboard_summary(date, date, text, boolean) to anon, authenticated;
