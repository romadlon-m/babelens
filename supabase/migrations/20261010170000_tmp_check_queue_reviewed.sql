-- Temporary diagnostic mirroring admin_ml_shadow_queue_by_article() minus the is_admin
-- gate, to verify the new reviewed/staleness logic end-to-end. Dropped in the next
-- migration.
create or replace function tmp_check_queue_reviewed(p_news_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  with latest_screener as (
    select distinct on (news_id) news_id, hasil, created_at
    from labeling_log where jenis = 'screener' and source = 'labeling' and hasil <> '{}'::jsonb
    order by news_id, created_at desc
  ),
  latest_lapus as (
    select distinct on (news_id) news_id, hasil, created_at
    from labeling_log where jenis = 'lapus' and source = 'labeling' and hasil <> '{}'::jsonb
    order by news_id, created_at desc
  ),
  latest_peng as (
    select distinct on (news_id) news_id, hasil, created_at
    from labeling_log where jenis = 'pengeluaran' and source = 'labeling' and hasil <> '{}'::jsonb
    order by news_id, created_at desc
  ),
  preds_latest as (
    select distinct on (news_id, jenis)
      news_id, jenis, predicted_relevan, predicted_kategori, predicted_arah, reviewed_at
    from ml_shadow_predictions where news_id = p_news_id
    order by news_id, jenis, predicted_at desc
  ),
  preds as (
    select
      news_id,
      max(predicted_relevan) filter (where jenis = 'lapus') as lapus_pred_relevan,
      max(reviewed_at) filter (where jenis = 'lapus') as lapus_reviewed_at,
      max(predicted_kategori) filter (where jenis = 'lapus_kategori') as lapus_pred_kategori,
      max(predicted_arah) filter (where jenis = 'lapus_kategori') as lapus_pred_arah,
      max(reviewed_at) filter (where jenis = 'lapus_kategori') as lapus_kategori_reviewed_at
    from preds_latest group by news_id
  ),
  joined as (
    select
      n.id as news_id,
      (ll.news_id is not null) as lapus_has_label,
      p.lapus_pred_relevan,
      ll.hasil ->> 'relevan' as lapus_actual_relevan,
      coalesce(p.lapus_pred_kategori, '{}'::text[]) as lapus_pred_kategori,
      coalesce(array(select jsonb_array_elements_text(ll.hasil -> 'kategori')), '{}'::text[]) as lapus_actual_kategori,
      p.lapus_pred_arah,
      ll.hasil ->> 'arah' as lapus_actual_arah,
      (p.lapus_reviewed_at is not null and p.lapus_reviewed_at >= ll.created_at
        and p.lapus_kategori_reviewed_at is not null and p.lapus_kategori_reviewed_at >= ll.created_at) as lapus_reviewed
    from news n
    left join preds p on p.news_id = n.id
    left join latest_lapus ll on ll.news_id = n.id
    where n.id = p_news_id
  )
  select jsonb_build_object(
    'has_label', lapus_has_label, 'predicted_relevan', lapus_pred_relevan,
    'actual_relevan', lapus_actual_relevan,
    'predicted_kategori', lapus_pred_kategori, 'actual_kategori', lapus_actual_kategori,
    'predicted_arah', lapus_pred_arah, 'actual_arah', lapus_actual_arah,
    'mismatch', (
      lapus_has_label and (
        lapus_pred_relevan is distinct from lapus_actual_relevan
        or not (lapus_pred_kategori @> lapus_actual_kategori and lapus_actual_kategori @> lapus_pred_kategori)
        or lapus_pred_arah is distinct from lapus_actual_arah
      )
    ),
    'reviewed', coalesce(lapus_reviewed, false)
  ) into v_result
  from joined;

  return v_result;
end;
$$;

grant execute on function tmp_check_queue_reviewed(bigint) to service_role;
