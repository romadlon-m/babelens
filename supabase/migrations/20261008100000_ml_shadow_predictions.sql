-- Shadow mode untuk 5 model klasifikasi (Screener, L1, P1, L2, P2) hasil training di
-- news-scraper-babel (models/binary_classifiers/, lihat SHADOW_MODE_PLAN.md repo tersebut).
-- Tabel ini CUMA menyimpan prediksi model untuk dipantau berkala -- TIDAK pernah dibaca
-- oleh claim_next_news_for_labeling()/labeling_queue_count() atau ditampilkan di
-- labeling-*.html. Labeler tidak terpengaruh sama sekali.

create table if not exists ml_shadow_predictions (
  id bigint generated always as identity primary key,
  news_id bigint not null references news(id) on delete cascade,
  jenis text not null check (jenis in ('screener','lapus','pengeluaran','lapus_kategori','pengeluaran_kategori')),
  model_version text not null,
  predicted_relevan text,      -- 'Ya'/'Tidak' (lolos dipetakan ke 'Ya'/'Tidak' juga, bukan boolean, utk konsistensi)
  predicted_kategori text[],   -- null kecuali jenis = lapus_kategori/pengeluaran_kategori
  predicted_arah text,         -- null kecuali jenis = lapus_kategori/pengeluaran_kategori
  predicted_at timestamptz not null default now(),
  unique (news_id, jenis, model_version)
);

comment on table ml_shadow_predictions is
  'Prediksi shadow mode 5 model klasifikasi PDRB. Tidak terkait antrean/queue labeling -- hanya untuk pemantauan berkala via admin-ml-monitor.html. Lihat SHADOW_MODE_PLAN.md di repo news-scraper-babel.';

create index if not exists ml_shadow_predictions_news_jenis_idx on ml_shadow_predictions (news_id, jenis);
create index if not exists ml_shadow_predictions_predicted_at_idx on ml_shadow_predictions (predicted_at);

alter table ml_shadow_predictions enable row level security;

-- Baca: admin-only (dipakai admin-ml-monitor.html). Tulis: tidak ada policy untuk
-- authenticated sama sekali -- hanya service_role (dipakai script shadow_predict.py
-- dari repo news-scraper-babel) yang bisa insert, dan service_role bypass RLS secara
-- default sehingga tidak perlu policy insert terpisah.
create policy ml_shadow_predictions_select_admin on ml_shadow_predictions
  for select using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin)
  );

-- WAJIB: grant tabel-level selain RLS policy -- lihat catatan "RLS tanpa GRANT" di
-- CLAUDE.md ("Bugs found post-deploy"), sudah terjadi 3x di tabel lain pada proyek ini.
-- service_role butuh select+insert (dipakai script Python dari news-scraper-babel repo
-- lewat service role key). authenticated butuh select (dipakai halaman admin, RLS di
-- atas yang membatasi ke admin saja).
grant select, insert on ml_shadow_predictions to service_role;
grant select on ml_shadow_predictions to authenticated;
grant usage on sequence ml_shadow_predictions_id_seq to service_role;


-- RPC ringkasan akurasi/F1 per jenis, untuk halaman admin-ml-monitor.html.
-- SECURITY DEFINER + cek is_admin manual (pola sama dengan admin_labeling_detail()/
-- admin_review_queue_by_article()) supaya bisa join ke labeling_log (yang RLS-nya
-- admin-only) tanpa masalah permission berlapis.
create or replace function admin_ml_shadow_summary(
  p_jenis text,
  p_date_from date default null,
  p_date_to date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_admin boolean;
  v_result jsonb;
  v_label_key text;
begin
  select is_admin into v_is_admin from profiles where id = auth.uid();
  if not coalesce(v_is_admin, false) then
    raise exception 'forbidden';
  end if;

  v_label_key := case
    when p_jenis = 'screener' then 'lolos'
    else 'relevan'
  end;

  -- n, jumlah cocok, dan n per label (Ya/Tidak) -- dihitung di SQL, bukan client-side,
  -- karena tabel ini akan terus bertambah tiap hari (sama alasan dengan dashboard_summary()).
  with joined as (
    select
      sp.news_id,
      sp.predicted_relevan,
      ll.hasil ->> v_label_key as actual_relevan
    from ml_shadow_predictions sp
    join labeling_log ll
      on ll.news_id = sp.news_id
     and ll.jenis = sp.jenis
     and ll.source = 'labeling'
     and ll.hasil <> '{}'::jsonb
    where sp.jenis = p_jenis
      and (p_date_from is null or sp.predicted_at >= p_date_from)
      and (p_date_to is null or sp.predicted_at < (p_date_to + 1))
  ),
  normalized as (
    -- hasil.lolos untuk screener adalah boolean asli, bukan string -- normalisasi ke
    -- 'Ya'/'Tidak' yang sama dgn predicted_relevan (lihat catatan tipe data di
    -- news-scraper-babel CLAUDE.md "Implementasi" bagian train_binary_models.py)
    select
      news_id,
      predicted_relevan,
      case
        when actual_relevan in ('true', 'Ya') then 'Ya'
        when actual_relevan in ('false', 'Tidak') then 'Tidak'
        else null
      end as actual_relevan
    from joined
  )
  select jsonb_build_object(
    'n', count(*),
    'n_match', count(*) filter (where predicted_relevan = actual_relevan),
    'accuracy', round(
      (count(*) filter (where predicted_relevan = actual_relevan))::numeric
        / greatest(count(*), 1), 4
    )
  ) into v_result
  from normalized
  where actual_relevan is not null;

  return coalesce(v_result, jsonb_build_object('n', 0, 'n_match', 0, 'accuracy', null));
end;
$$;

grant execute on function admin_ml_shadow_summary(text, date, date) to authenticated;


-- RPC daftar disagreement (prediksi != aktual), untuk tabel manual-review di halaman admin.
create or replace function admin_ml_shadow_disagreements(
  p_jenis text,
  p_date_from date default null,
  p_date_to date default null,
  p_page int default 1,
  p_page_size int default 20
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_admin boolean;
  v_label_key text;
  v_offset int;
  v_page_size int;
  v_total int;
  v_rows jsonb;
begin
  select is_admin into v_is_admin from profiles where id = auth.uid();
  if not coalesce(v_is_admin, false) then
    raise exception 'forbidden';
  end if;

  v_label_key := case when p_jenis = 'screener' then 'lolos' else 'relevan' end;
  v_page_size := least(greatest(coalesce(p_page_size, 20), 1), 100);
  v_offset := (greatest(coalesce(p_page, 1), 1) - 1) * v_page_size;

  with joined as (
    select
      sp.id,
      sp.news_id,
      n.title,
      sp.predicted_relevan,
      case
        when (ll.hasil ->> v_label_key) in ('true', 'Ya') then 'Ya'
        when (ll.hasil ->> v_label_key) in ('false', 'Tidak') then 'Tidak'
        else null
      end as actual_relevan,
      sp.predicted_at
    from ml_shadow_predictions sp
    join news n on n.id = sp.news_id
    join labeling_log ll
      on ll.news_id = sp.news_id
     and ll.jenis = sp.jenis
     and ll.source = 'labeling'
     and ll.hasil <> '{}'::jsonb
    where sp.jenis = p_jenis
      and (p_date_from is null or sp.predicted_at >= p_date_from)
      and (p_date_to is null or sp.predicted_at < (p_date_to + 1))
  ),
  mismatched as (
    select * from joined
    where actual_relevan is not null and predicted_relevan is distinct from actual_relevan
  )
  select
    (select count(*) from mismatched),
    (
      select jsonb_agg(jsonb_build_object(
        'news_id', news_id, 'title', title, 'predicted_relevan', predicted_relevan,
        'actual_relevan', actual_relevan, 'predicted_at', predicted_at
      ) order by predicted_at desc)
      from (
        select * from mismatched order by predicted_at desc
        limit v_page_size offset v_offset
      ) p
    )
  into v_total, v_rows;

  return jsonb_build_object('total', v_total, 'rows', coalesce(v_rows, '[]'::jsonb));
end;
$$;

grant execute on function admin_ml_shadow_disagreements(text, date, date, int, int) to authenticated;
