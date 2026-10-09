-- Temporary diagnostic (same pattern as other tmp_check_*/drop_tmp_* pairs in this repo)
-- to smoke-test admin_ml_shadow_queue_by_article()'s query logic without an authenticated
-- admin session (no is_admin gate here). Dropped in the next migration.
create or replace function tmp_check_shadow_queue_by_article(
  p_only_mismatch boolean default true,
  p_page_size int default 3
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total int;
  v_rows jsonb;
begin
  with preds_latest as (
    select distinct on (news_id, jenis)
      news_id, jenis, predicted_relevan, predicted_kategori, predicted_arah
    from ml_shadow_predictions
    order by news_id, jenis, predicted_at desc
  ),
  preds as (
    select
      news_id,
      max(predicted_relevan) filter (where jenis = 'screener') as scr_pred_relevan,
      max(predicted_relevan) filter (where jenis = 'lapus') as lapus_pred_relevan,
      max(predicted_relevan) filter (where jenis = 'pengeluaran') as peng_pred_relevan,
      max(predicted_kategori) filter (where jenis = 'lapus_kategori') as lapus_pred_kategori,
      max(predicted_arah) filter (where jenis = 'lapus_kategori') as lapus_pred_arah,
      max(predicted_kategori) filter (where jenis = 'pengeluaran_kategori') as peng_pred_kategori,
      max(predicted_arah) filter (where jenis = 'pengeluaran_kategori') as peng_pred_arah
    from preds_latest
    group by news_id
  ),
  latest_screener as (
    select distinct on (news_id) news_id, hasil
    from labeling_log
    where jenis = 'screener' and source = 'labeling' and hasil <> '{}'::jsonb
    order by news_id, created_at desc
  ),
  latest_lapus as (
    select distinct on (news_id) news_id, hasil
    from labeling_log
    where jenis = 'lapus' and source = 'labeling' and hasil <> '{}'::jsonb
    order by news_id, created_at desc
  ),
  latest_peng as (
    select distinct on (news_id) news_id, hasil
    from labeling_log
    where jenis = 'pengeluaran' and source = 'labeling' and hasil <> '{}'::jsonb
    order by news_id, created_at desc
  ),
  joined as (
    select
      n.id as news_id,
      n.title,
      n.publication_datetime,
      (ls.news_id is not null) as scr_has_label,
      p.scr_pred_relevan,
      case
        when (ls.hasil ->> 'lolos') in ('true', 'Ya') then 'Ya'
        when (ls.hasil ->> 'lolos') in ('false', 'Tidak') then 'Tidak'
        else null
      end as scr_actual_relevan,
      (ll.news_id is not null) as lapus_has_label,
      p.lapus_pred_relevan,
      ll.hasil ->> 'relevan' as lapus_actual_relevan,
      p.lapus_pred_kategori,
      array(select jsonb_array_elements_text(coalesce(ll.hasil -> 'kategori', '[]'::jsonb)) order by 1) as lapus_actual_kategori,
      p.lapus_pred_arah,
      ll.hasil ->> 'arah' as lapus_actual_arah,
      (lp.news_id is not null) as peng_has_label,
      p.peng_pred_relevan,
      lp.hasil ->> 'relevan' as peng_actual_relevan,
      p.peng_pred_kategori,
      array(select jsonb_array_elements_text(coalesce(lp.hasil -> 'komponen', '[]'::jsonb)) order by 1) as peng_actual_kategori,
      p.peng_pred_arah,
      lp.hasil ->> 'arah' as peng_actual_arah
    from news n
    left join preds p on p.news_id = n.id
    left join latest_screener ls on ls.news_id = n.id
    left join latest_lapus ll on ll.news_id = n.id
    left join latest_peng lp on lp.news_id = n.id
  ),
  normalized as (
    select
      j.*,
      array(select unnest(coalesce(lapus_pred_kategori, '{}'::text[])) order by 1) as lapus_pred_kategori_sorted,
      array(select unnest(coalesce(peng_pred_kategori, '{}'::text[])) order by 1) as peng_pred_kategori_sorted
    from joined j
  ),
  flagged as (
    select
      nm.*,
      (scr_has_label and scr_pred_relevan is distinct from scr_actual_relevan) as scr_mismatch,
      (lapus_has_label and (
        lapus_pred_relevan is distinct from lapus_actual_relevan
        or lapus_pred_kategori_sorted is distinct from lapus_actual_kategori
        or lapus_pred_arah is distinct from lapus_actual_arah
      )) as lapus_mismatch,
      (peng_has_label and (
        peng_pred_relevan is distinct from peng_actual_relevan
        or peng_pred_kategori_sorted is distinct from peng_actual_kategori
        or peng_pred_arah is distinct from peng_actual_arah
      )) as peng_mismatch
    from normalized nm
  ),
  final as (
    select * from flagged
    where not p_only_mismatch or (scr_mismatch or lapus_mismatch or peng_mismatch)
  )
  select
    (select count(*) from final),
    (
      select jsonb_agg(jsonb_build_object(
        'news_id', news_id, 'title', title,
        'screener', jsonb_build_object(
          'has_label', scr_has_label, 'predicted_relevan', scr_pred_relevan,
          'actual_relevan', scr_actual_relevan, 'mismatch', scr_mismatch
        ),
        'lapus', jsonb_build_object(
          'has_label', lapus_has_label, 'predicted_relevan', lapus_pred_relevan,
          'actual_relevan', lapus_actual_relevan,
          'predicted_kategori', lapus_pred_kategori_sorted, 'actual_kategori', lapus_actual_kategori,
          'predicted_arah', lapus_pred_arah, 'actual_arah', lapus_actual_arah,
          'mismatch', lapus_mismatch
        ),
        'pengeluaran', jsonb_build_object(
          'has_label', peng_has_label, 'predicted_relevan', peng_pred_relevan,
          'actual_relevan', peng_actual_relevan,
          'predicted_kategori', peng_pred_kategori_sorted, 'actual_kategori', peng_actual_kategori,
          'predicted_arah', peng_pred_arah, 'actual_arah', peng_actual_arah,
          'mismatch', peng_mismatch
        )
      ) order by publication_datetime desc nulls last, news_id desc)
      from (
        select * from final
        order by publication_datetime desc nulls last, news_id desc
        limit p_page_size
      ) pg
    )
  into v_total, v_rows;

  return jsonb_build_object('total', v_total, 'rows', coalesce(v_rows, '[]'::jsonb));
end;
$$;

grant execute on function tmp_check_shadow_queue_by_article(boolean, int) to service_role;
