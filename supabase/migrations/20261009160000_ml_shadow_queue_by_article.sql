-- admin-ml-monitor.html rework: per-artikel (3 kolom Screener/Lapus/Pengeluaran),
-- bukan per-jenis (5 jenis terpisah) -- sama pola dengan admin_review_queue_by_article()
-- di admin-review.html, dan untuk alasan yang sama: supaya admin tidak bolak-balik ganti
-- filter jenis untuk artikel yang sama. L2 (kategori+arah Lapus) dan P2 (kategori+arah
-- Pengeluaran) BUKAN jenis labeling_log terpisah -- keduanya adalah prediksi tambahan
-- terhadap SATU baris aktual labeling_log jenis 'lapus'/'pengeluaran' yang sama (yang
-- sudah berisi relevan+kategori+arah sekaligus), jadi digabung ke kolom Lapus/Pengeluaran,
-- bukan jadi kolom ke-4/5 sendiri -- total tetap 5 model, ditampilkan di 3 kolom.
--
-- "mismatch" per kolom = true kalau SALAH SATU dari field yang relevan untuk kolom itu
-- berbeda dari aktual (Screener: cuma relevan; Lapus/Pengeluaran: relevan ATAU kategori
-- ATAU arah) -- dan hanya dihitung kalau kolom itu sudah punya label aktual (tidak ada
-- mismatch tanpa pembanding). p_only_mismatch (default true) memfilter baris yang
-- SETIDAKNYA satu dari 3 kolomnya mismatch -- baris yang semua kolomnya cocok atau belum
-- dilabel sama sekali otomatis tidak muncul (self-clearing, sama seperti
-- admin_review_queue_by_article()).
create or replace function admin_ml_shadow_queue_by_article(
  p_date_from date default null,
  p_date_to date default null,
  p_only_mismatch boolean default true,
  p_page int default 1,
  p_page_size int default 10
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_admin boolean;
  v_page_size int;
  v_offset int;
  v_total int;
  v_rows jsonb;
begin
  select is_admin into v_is_admin from profiles where id = auth.uid();
  if not coalesce(v_is_admin, false) then
    raise exception 'forbidden';
  end if;

  -- page_size dibatasi kecil (maks 20) karena ini kartu besar 3 kolom, bukan baris
  -- tabel ringkas -- sama alasan dengan admin_review_queue_by_article().
  v_page_size := least(greatest(coalesce(p_page_size, 10), 1), 20);
  v_offset := (greatest(coalesce(p_page, 1), 1) - 1) * v_page_size;

  with preds_latest as (
    -- satu news_id+jenis mestinya cuma punya 1 model_version aktif saat ini, tapi
    -- distinct-on by predicted_at desc supaya tetap benar kalau suatu saat ada >1
    -- versi model tersimpan berdampingan (lihat komentar MODEL_VERSION di shadow_predict.py).
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
    where (p_date_from is null or n.publication_datetime >= p_date_from)
      and (p_date_to is null or n.publication_datetime < (p_date_to + 1))
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
        'news_id', news_id, 'title', title, 'publication_datetime', publication_datetime,
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
        limit v_page_size offset v_offset
      ) pg
    )
  into v_total, v_rows;

  return jsonb_build_object('total', v_total, 'rows', coalesce(v_rows, '[]'::jsonb));
end;
$$;

grant execute on function admin_ml_shadow_queue_by_article(date, date, boolean, int, int) to authenticated;
