-- Tombol "✅ Sesuai" di admin-ml-monitor.html: menandai bahwa Prediksi yang beda dari
-- Aktual itu BUKAN masalah (Prediksi model yang salah, Aktual sudah benar) -- supaya
-- baris itu tidak terus-menerus muncul lagi di filter "Hanya yang berbeda" selamanya.
-- TIDAK PERNAH mengubah Prediksi itu sendiri -- prediksi tetap catatan historis apa kata
-- model saat itu, dipakai untuk melacak akurasi model dari waktu ke waktu; kalau prediksi
-- ikut "dibenarkan" tiap kali meleset, statistik akurasi jadi bias (lihat diskusi di
-- riwayat chat).
--
-- Kolom direct di ml_shadow_predictions (bukan tabel terpisah seperti
-- labeling_qc_review-nya admin-review.html) -- sengaja TIDAK reuse labeling_qc_review,
-- itu soal berbeda (status prompt_version_id, bukan soal prediksi vs aktual) dan kalau
-- digabung jadi mengaburkan dua konsep yang tidak berhubungan.
--
-- Validitas "sudah direview" otomatis batal kalau Aktual dikoreksi ulang SETELAH ditandai
-- -- dicek dengan membandingkan reviewed_at terhadap created_at entri labeling_log
-- terbaru untuk jenis itu, bukan disimpan sebagai snapshot terpisah (lebih sederhana,
-- dan otomatis benar selama reviewed_at tidak dimanipulasi langsung).
alter table ml_shadow_predictions
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references profiles(id);

create index if not exists ml_shadow_predictions_reviewed_idx
  on ml_shadow_predictions (news_id, jenis, reviewed_at);

create or replace function admin_ml_shadow_mark_reviewed(
  p_news_id bigint,
  p_jenis text -- 'screener' | 'lapus' | 'pengeluaran' (kolom UI, bukan jenis mentah)
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_admin boolean;
  v_jenis_list text[];
begin
  select is_admin into v_is_admin from profiles where id = auth.uid();
  if not coalesce(v_is_admin, false) then
    raise exception 'forbidden';
  end if;

  -- kolom Lapus/Pengeluaran di UI menggabungkan 2 jenis prediksi (relevan + kategori+arah)
  -- yang dibandingkan ke SATU aktual yang sama -- ditandai reviewed bersamaan, supaya
  -- "Sesuai" di satu kolom UI konsisten utk kedua model di baliknya.
  v_jenis_list := case p_jenis
    when 'screener' then array['screener']
    when 'lapus' then array['lapus', 'lapus_kategori']
    when 'pengeluaran' then array['pengeluaran', 'pengeluaran_kategori']
    else null
  end;
  if v_jenis_list is null then
    raise exception 'jenis tidak dikenal: %', p_jenis;
  end if;

  update ml_shadow_predictions
  set reviewed_at = now(), reviewed_by = auth.uid()
  where news_id = p_news_id and jenis = any(v_jenis_list);
end;
$$;

grant execute on function admin_ml_shadow_mark_reviewed(bigint, text) to authenticated;


-- admin_ml_shadow_queue_by_article() diperbarui: tambah reviewed_at per jenis +
-- bandingkan terhadap created_at aktual terakhir -- "sudah direview" HANYA valid kalau
-- reviewed_at >= created_at aktual (kalau aktual dikoreksi ulang setelah ditandai, status
-- "sudah direview" otomatis batal, kolom resurface di filter "Hanya yang berbeda").
-- p_only_mismatch sekarang berarti "mismatch DAN belum (valid) direview".
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

  v_page_size := least(greatest(coalesce(p_page_size, 10), 1), 20);
  v_offset := (greatest(coalesce(p_page, 1), 1) - 1) * v_page_size;

  with latest_screener as (
    select distinct on (news_id) news_id, hasil, created_at
    from labeling_log
    where jenis = 'screener' and source = 'labeling' and hasil <> '{}'::jsonb
    order by news_id, created_at desc
  ),
  latest_lapus as (
    select distinct on (news_id) news_id, hasil, created_at
    from labeling_log
    where jenis = 'lapus' and source = 'labeling' and hasil <> '{}'::jsonb
    order by news_id, created_at desc
  ),
  latest_peng as (
    select distinct on (news_id) news_id, hasil, created_at
    from labeling_log
    where jenis = 'pengeluaran' and source = 'labeling' and hasil <> '{}'::jsonb
    order by news_id, created_at desc
  ),
  labeled_ids as (
    select news_id from latest_screener
    union
    select news_id from latest_lapus
    union
    select news_id from latest_peng
  ),
  preds_latest as (
    select distinct on (news_id, jenis)
      news_id, jenis, predicted_relevan, predicted_kategori, predicted_arah, reviewed_at
    from ml_shadow_predictions
    where news_id in (select news_id from labeled_ids)
    order by news_id, jenis, predicted_at desc
  ),
  preds as (
    select
      news_id,
      max(predicted_relevan) filter (where jenis = 'screener') as scr_pred_relevan,
      max(reviewed_at) filter (where jenis = 'screener') as scr_reviewed_at,
      max(predicted_relevan) filter (where jenis = 'lapus') as lapus_pred_relevan,
      max(reviewed_at) filter (where jenis = 'lapus') as lapus_reviewed_at,
      max(predicted_relevan) filter (where jenis = 'pengeluaran') as peng_pred_relevan,
      max(reviewed_at) filter (where jenis = 'pengeluaran') as peng_reviewed_at,
      max(predicted_kategori) filter (where jenis = 'lapus_kategori') as lapus_pred_kategori,
      max(predicted_arah) filter (where jenis = 'lapus_kategori') as lapus_pred_arah,
      max(reviewed_at) filter (where jenis = 'lapus_kategori') as lapus_kategori_reviewed_at,
      max(predicted_kategori) filter (where jenis = 'pengeluaran_kategori') as peng_pred_kategori,
      max(predicted_arah) filter (where jenis = 'pengeluaran_kategori') as peng_pred_arah,
      max(reviewed_at) filter (where jenis = 'pengeluaran_kategori') as peng_kategori_reviewed_at
    from preds_latest
    group by news_id
  ),
  joined as (
    select
      n.id as news_id,
      n.title,
      n.summary,
      n.publication_datetime,

      (ls.news_id is not null) as scr_has_label,
      p.scr_pred_relevan,
      case
        when (ls.hasil ->> 'lolos') in ('true', 'Ya') then 'Ya'
        when (ls.hasil ->> 'lolos') in ('false', 'Tidak') then 'Tidak'
        else null
      end as scr_actual_relevan,
      ls.hasil ->> 'alasan' as scr_actual_alasan,
      (p.scr_reviewed_at is not null and p.scr_reviewed_at >= ls.created_at) as scr_reviewed,

      (ll.news_id is not null) as lapus_has_label,
      p.lapus_pred_relevan,
      ll.hasil ->> 'relevan' as lapus_actual_relevan,
      coalesce(p.lapus_pred_kategori, '{}'::text[]) as lapus_pred_kategori,
      coalesce(array(select jsonb_array_elements_text(ll.hasil -> 'kategori')), '{}'::text[]) as lapus_actual_kategori,
      p.lapus_pred_arah,
      ll.hasil ->> 'arah' as lapus_actual_arah,
      ll.hasil ->> 'alasan' as lapus_actual_alasan,
      (p.lapus_reviewed_at is not null and p.lapus_reviewed_at >= ll.created_at
        and p.lapus_kategori_reviewed_at is not null and p.lapus_kategori_reviewed_at >= ll.created_at) as lapus_reviewed,

      (lp.news_id is not null) as peng_has_label,
      p.peng_pred_relevan,
      lp.hasil ->> 'relevan' as peng_actual_relevan,
      coalesce(p.peng_pred_kategori, '{}'::text[]) as peng_pred_kategori,
      coalesce(array(select jsonb_array_elements_text(lp.hasil -> 'komponen')), '{}'::text[]) as peng_actual_kategori,
      p.peng_pred_arah,
      lp.hasil ->> 'arah' as peng_actual_arah,
      lp.hasil ->> 'alasan' as peng_actual_alasan,
      (p.peng_reviewed_at is not null and p.peng_reviewed_at >= lp.created_at
        and p.peng_kategori_reviewed_at is not null and p.peng_kategori_reviewed_at >= lp.created_at) as peng_reviewed
    from labeled_ids ids
    join news n on n.id = ids.news_id
    left join preds p on p.news_id = n.id
    left join latest_screener ls on ls.news_id = n.id
    left join latest_lapus ll on ll.news_id = n.id
    left join latest_peng lp on lp.news_id = n.id
    where (p_date_from is null or n.publication_datetime >= p_date_from)
      and (p_date_to is null or n.publication_datetime < (p_date_to + 1))
  ),
  flagged as (
    select
      j.*,
      (scr_has_label and scr_pred_relevan is distinct from scr_actual_relevan) as scr_mismatch,
      (lapus_has_label and (
        lapus_pred_relevan is distinct from lapus_actual_relevan
        or not (lapus_pred_kategori @> lapus_actual_kategori and lapus_actual_kategori @> lapus_pred_kategori)
        or lapus_pred_arah is distinct from lapus_actual_arah
      )) as lapus_mismatch,
      (peng_has_label and (
        peng_pred_relevan is distinct from peng_actual_relevan
        or not (peng_pred_kategori @> peng_actual_kategori and peng_actual_kategori @> peng_pred_kategori)
        or peng_pred_arah is distinct from peng_actual_arah
      )) as peng_mismatch
    from joined j
  ),
  actionable as (
    select
      f.*,
      (scr_mismatch and not coalesce(scr_reviewed, false)) as scr_actionable,
      (lapus_mismatch and not coalesce(lapus_reviewed, false)) as lapus_actionable,
      (peng_mismatch and not coalesce(peng_reviewed, false)) as peng_actionable
    from flagged f
  ),
  final as (
    select * from actionable
    where not p_only_mismatch or (scr_actionable or lapus_actionable or peng_actionable)
  )
  select
    (select count(*) from final),
    (
      select jsonb_agg(jsonb_build_object(
        'news_id', news_id, 'title', title, 'summary', summary, 'publication_datetime', publication_datetime,
        'screener', jsonb_build_object(
          'has_label', scr_has_label, 'predicted_relevan', scr_pred_relevan,
          'actual_relevan', scr_actual_relevan, 'actual_alasan', scr_actual_alasan,
          'mismatch', scr_mismatch, 'reviewed', coalesce(scr_reviewed, false)
        ),
        'lapus', jsonb_build_object(
          'has_label', lapus_has_label, 'predicted_relevan', lapus_pred_relevan,
          'actual_relevan', lapus_actual_relevan,
          'predicted_kategori', lapus_pred_kategori, 'actual_kategori', lapus_actual_kategori,
          'predicted_arah', lapus_pred_arah, 'actual_arah', lapus_actual_arah,
          'actual_alasan', lapus_actual_alasan, 'mismatch', lapus_mismatch,
          'reviewed', coalesce(lapus_reviewed, false)
        ),
        'pengeluaran', jsonb_build_object(
          'has_label', peng_has_label, 'predicted_relevan', peng_pred_relevan,
          'actual_relevan', peng_actual_relevan,
          'predicted_kategori', peng_pred_kategori, 'actual_kategori', peng_actual_kategori,
          'predicted_arah', peng_pred_arah, 'actual_arah', peng_actual_arah,
          'actual_alasan', peng_actual_alasan, 'mismatch', peng_mismatch,
          'reviewed', coalesce(peng_reviewed, false)
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
