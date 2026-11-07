-- Label tulisan ML screener (labeling_log.batch_tag = 'ml-screener', lihat
-- news-scraper-babel/scripts/ml_screener_write.py) adalah keluaran model itu sendiri:
--  * pemantau shadow (admin_ml_shadow_*) tidak boleh membandingkan model dengan tulisannya
--    sendiri (akurasi palsu 100%) -> tambah `batch_tag is distinct from 'ml-screener'`.
--  * Review Label (admin_review_queue_by_article) tidak boleh dibanjiri ~1.3k+ artikel
--    ml-screener -> artikel yang label Lapus/Pengeluaran terakhirnya ml-screener dikecualikan.
-- Semua fungsi: create or replace, signature TIDAK berubah. Body = definisi live (pg_get_functiondef)
-- 2026-11-07 + penambahan di atas saja.

CREATE OR REPLACE FUNCTION public.admin_ml_shadow_summary(p_jenis text, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_is_admin boolean;
  v_result jsonb;
  v_label_key text;
  v_log_jenis text;
  v_is_kategori boolean;
begin
  select is_admin into v_is_admin from profiles where id = auth.uid();
  if not coalesce(v_is_admin, false) then
    raise exception 'forbidden';
  end if;

  v_is_kategori := p_jenis in ('lapus_kategori', 'pengeluaran_kategori');
  v_log_jenis := case
    when p_jenis = 'lapus_kategori' then 'lapus'
    when p_jenis = 'pengeluaran_kategori' then 'pengeluaran'
    else p_jenis
  end;
  v_label_key := case when v_log_jenis = 'screener' then 'lolos' else 'relevan' end;

  if not v_is_kategori then
    with joined as (
      select
        sp.predicted_relevan,
        case
          when (ll.hasil ->> v_label_key) in ('true', 'Ya') then 'Ya'
          when (ll.hasil ->> v_label_key) in ('false', 'Tidak') then 'Tidak'
          else null
        end as actual_relevan
      from ml_shadow_predictions sp
      join labeling_log ll
        on ll.news_id = sp.news_id
       and ll.jenis = v_log_jenis
       and ll.source = 'labeling'
       and ll.batch_tag is distinct from 'ml-screener'
       and ll.hasil <> '{}'::jsonb
      where sp.jenis = p_jenis
        and (p_date_from is null or sp.predicted_at >= p_date_from)
        and (p_date_to is null or sp.predicted_at < (p_date_to + 1))
    )
    select jsonb_build_object(
      'n', count(*),
      'n_match', count(*) filter (where predicted_relevan = actual_relevan),
      'accuracy', round(
        (count(*) filter (where predicted_relevan = actual_relevan))::numeric
          / greatest(count(*), 1), 4
      )
    ) into v_result
    from joined
    where actual_relevan is not null;
  else
    declare
      v_category_key text := case when v_log_jenis = 'lapus' then 'kategori' else 'komponen' end;
    begin
      with joined as (
        select
          sp.predicted_kategori,
          sp.predicted_arah,
          array(select jsonb_array_elements_text(coalesce(ll.hasil -> v_category_key, '[]'::jsonb)) order by 1) as actual_kategori_raw,
          ll.hasil ->> 'arah' as actual_arah
        from ml_shadow_predictions sp
        join labeling_log ll
          on ll.news_id = sp.news_id
         and ll.jenis = v_log_jenis
         and ll.source = 'labeling'
         and ll.batch_tag is distinct from 'ml-screener'
         and ll.hasil <> '{}'::jsonb
        where sp.jenis = p_jenis
          and (p_date_from is null or sp.predicted_at >= p_date_from)
          and (p_date_to is null or sp.predicted_at < (p_date_to + 1))
      ),
      normalized as (
        select
          array(select unnest(coalesce(predicted_kategori, '{}'::text[])) order by 1) as predicted_kategori_sorted,
          actual_kategori_raw,
          predicted_arah,
          actual_arah
        from joined
        where actual_arah is not null
      )
      select jsonb_build_object(
        'n', count(*),
        'n_kategori_match', count(*) filter (where predicted_kategori_sorted = actual_kategori_raw),
        'kategori_exact_match_ratio', round(
          (count(*) filter (where predicted_kategori_sorted = actual_kategori_raw))::numeric
            / greatest(count(*), 1), 4
        ),
        'n_arah_match', count(*) filter (where predicted_arah = actual_arah),
        'arah_accuracy', round(
          (count(*) filter (where predicted_arah = actual_arah))::numeric
            / greatest(count(*), 1), 4
        )
      ) into v_result
      from normalized;
    end;
  end if;

  return coalesce(
    v_result,
    case when v_is_kategori
      then jsonb_build_object('n', 0, 'n_kategori_match', 0, 'kategori_exact_match_ratio', null, 'n_arah_match', 0, 'arah_accuracy', null)
      else jsonb_build_object('n', 0, 'n_match', 0, 'accuracy', null)
    end
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_ml_shadow_disagreements(p_jenis text, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_page integer DEFAULT 1, p_page_size integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_is_admin boolean;
  v_label_key text;
  v_log_jenis text;
  v_is_kategori boolean;
  v_category_key text;
  v_offset int;
  v_page_size int;
  v_total int;
  v_rows jsonb;
begin
  select is_admin into v_is_admin from profiles where id = auth.uid();
  if not coalesce(v_is_admin, false) then
    raise exception 'forbidden';
  end if;

  v_is_kategori := p_jenis in ('lapus_kategori', 'pengeluaran_kategori');
  v_log_jenis := case
    when p_jenis = 'lapus_kategori' then 'lapus'
    when p_jenis = 'pengeluaran_kategori' then 'pengeluaran'
    else p_jenis
  end;
  v_label_key := case when v_log_jenis = 'screener' then 'lolos' else 'relevan' end;
  v_category_key := case when v_log_jenis = 'lapus' then 'kategori' else 'komponen' end;
  v_page_size := least(greatest(coalesce(p_page_size, 20), 1), 100);
  v_offset := (greatest(coalesce(p_page, 1), 1) - 1) * v_page_size;

  if not v_is_kategori then
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
       and ll.jenis = v_log_jenis
       and ll.source = 'labeling'
       and ll.batch_tag is distinct from 'ml-screener'
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
  else
    with joined as (
      select
        sp.id,
        sp.news_id,
        n.title,
        sp.predicted_kategori,
        sp.predicted_arah,
        array(select jsonb_array_elements_text(coalesce(ll.hasil -> v_category_key, '[]'::jsonb)) order by 1) as actual_kategori,
        ll.hasil ->> 'arah' as actual_arah,
        sp.predicted_at
      from ml_shadow_predictions sp
      join news n on n.id = sp.news_id
      join labeling_log ll
        on ll.news_id = sp.news_id
       and ll.jenis = v_log_jenis
       and ll.source = 'labeling'
       and ll.batch_tag is distinct from 'ml-screener'
       and ll.hasil <> '{}'::jsonb
      where sp.jenis = p_jenis
        and (p_date_from is null or sp.predicted_at >= p_date_from)
        and (p_date_to is null or sp.predicted_at < (p_date_to + 1))
    ),
    mismatched as (
      select *,
        array(select unnest(coalesce(predicted_kategori, '{}'::text[])) order by 1) as predicted_kategori_sorted
      from joined
      where actual_arah is not null
        and (
          array(select unnest(coalesce(predicted_kategori, '{}'::text[])) order by 1) is distinct from actual_kategori
          or predicted_arah is distinct from actual_arah
        )
    )
    select
      (select count(*) from mismatched),
      (
        select jsonb_agg(jsonb_build_object(
          'news_id', news_id, 'title', title,
          'predicted_kategori', predicted_kategori_sorted, 'actual_kategori', actual_kategori,
          'predicted_arah', predicted_arah, 'actual_arah', actual_arah, 'predicted_at', predicted_at
        ) order by predicted_at desc)
        from (
          select * from mismatched order by predicted_at desc
          limit v_page_size offset v_offset
        ) p
      )
    into v_total, v_rows;
  end if;

  return jsonb_build_object('total', v_total, 'rows', coalesce(v_rows, '[]'::jsonb));
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_ml_shadow_raw(p_jenis text, p_has_label boolean DEFAULT NULL::boolean, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_page integer DEFAULT 1, p_page_size integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_is_admin boolean;
  v_label_key text;
  v_log_jenis text;
  v_is_kategori boolean;
  v_category_key text;
  v_offset int;
  v_page_size int;
  v_total int;
  v_rows jsonb;
begin
  select is_admin into v_is_admin from profiles where id = auth.uid();
  if not coalesce(v_is_admin, false) then
    raise exception 'forbidden';
  end if;

  v_is_kategori := p_jenis in ('lapus_kategori', 'pengeluaran_kategori');
  v_log_jenis := case
    when p_jenis = 'lapus_kategori' then 'lapus'
    when p_jenis = 'pengeluaran_kategori' then 'pengeluaran'
    else p_jenis
  end;
  v_label_key := case when v_log_jenis = 'screener' then 'lolos' else 'relevan' end;
  v_category_key := case when v_log_jenis = 'lapus' then 'kategori' else 'komponen' end;
  v_page_size := least(greatest(coalesce(p_page_size, 20), 1), 100);
  v_offset := (greatest(coalesce(p_page, 1), 1) - 1) * v_page_size;

  with latest_log as (
    select distinct on (ll.news_id)
      ll.news_id, ll.hasil
    from labeling_log ll
    where ll.jenis = v_log_jenis
      and ll.source = 'labeling'
      and ll.batch_tag is distinct from 'ml-screener'
      and ll.hasil <> '{}'::jsonb
    order by ll.news_id, ll.created_at desc
  ),
  joined as (
    select
      sp.news_id,
      n.title,
      sp.predicted_relevan,
      sp.predicted_kategori,
      sp.predicted_arah,
      sp.predicted_at,
      (ll.news_id is not null) as has_label,
      case
        when not v_is_kategori and (ll.hasil ->> v_label_key) in ('true', 'Ya') then 'Ya'
        when not v_is_kategori and (ll.hasil ->> v_label_key) in ('false', 'Tidak') then 'Tidak'
        else null
      end as actual_relevan,
      case when v_is_kategori and ll.news_id is not null
        then array(select jsonb_array_elements_text(coalesce(ll.hasil -> v_category_key, '[]'::jsonb)) order by 1)
        else null
      end as actual_kategori,
      case when v_is_kategori then ll.hasil ->> 'arah' else null end as actual_arah
    from ml_shadow_predictions sp
    join news n on n.id = sp.news_id
    left join latest_log ll on ll.news_id = sp.news_id
    where sp.jenis = p_jenis
      and (p_date_from is null or sp.predicted_at >= p_date_from)
      and (p_date_to is null or sp.predicted_at < (p_date_to + 1))
      and (p_has_label is null or (ll.news_id is not null) = p_has_label)
  )
  select
    (select count(*) from joined),
    (
      select jsonb_agg(jsonb_build_object(
        'news_id', news_id, 'title', title,
        'predicted_relevan', predicted_relevan, 'actual_relevan', actual_relevan,
        'predicted_kategori', predicted_kategori, 'actual_kategori', actual_kategori,
        'predicted_arah', predicted_arah, 'actual_arah', actual_arah,
        'has_label', has_label, 'predicted_at', predicted_at
      ) order by predicted_at desc)
      from (
        select * from joined order by predicted_at desc
        limit v_page_size offset v_offset
      ) p
    )
  into v_total, v_rows;

  return jsonb_build_object('total', v_total, 'rows', coalesce(v_rows, '[]'::jsonb));
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_ml_shadow_queue_by_article(p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_only_mismatch boolean DEFAULT true, p_page integer DEFAULT 1, p_page_size integer DEFAULT 10)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    where jenis = 'screener' and source = 'labeling' and batch_tag is distinct from 'ml-screener' and hasil <> '{}'::jsonb
    order by news_id, created_at desc
  ),
  latest_lapus as (
    select distinct on (news_id) news_id, hasil, created_at
    from labeling_log
    where jenis = 'lapus' and source = 'labeling' and batch_tag is distinct from 'ml-screener' and hasil <> '{}'::jsonb
    order by news_id, created_at desc
  ),
  latest_peng as (
    select distinct on (news_id) news_id, hasil, created_at
    from labeling_log
    where jenis = 'pengeluaran' and source = 'labeling' and batch_tag is distinct from 'ml-screener' and hasil <> '{}'::jsonb
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
$function$;

-- Review Label: artikel yang label Lapus ATAU Pengeluaran terakhirnya tulisan ml-screener
-- dikecualikan dari antrean (sengaja tidak di-QC satu per satu; lihat ml_screener_write.py).
CREATE OR REPLACE FUNCTION public.admin_review_queue_by_article(p_page integer DEFAULT 1, p_page_size integer DEFAULT 10, p_completeness text DEFAULT NULL::text, p_batch text DEFAULT NULL::text, p_kondisi_label text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_is_admin boolean;
  v_offset int;
  v_screener_prompt_id uuid;
  v_lapus_prompt_id uuid;
  v_pengeluaran_prompt_id uuid;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  select is_admin into v_is_admin from profiles where id = v_uid;
  if not coalesce(v_is_admin, false) then
    raise exception 'forbidden: admin only';
  end if;
  if p_completeness is not null and p_completeness not in ('lengkap', 'sebagian') then
    raise exception 'completeness tidak valid: %', p_completeness;
  end if;
  if p_batch is not null and p_batch not in ('batch1', 'batch2') then
    raise exception 'batch tidak valid: %', p_batch;
  end if;
  if p_kondisi_label is not null and p_kondisi_label not in ('lolos_tidak', 'tidak_lolos', 'lolos_ya') then
    raise exception 'kondisi label tidak valid: %', p_kondisi_label;
  end if;

  p_page := greatest(coalesce(p_page, 1), 1);
  p_page_size := least(greatest(coalesce(p_page_size, 10), 1), 20);
  v_offset := (p_page - 1) * p_page_size;

  select id into v_screener_prompt_id from label_prompts where jenis = 'screener' and is_active limit 1;
  select id into v_lapus_prompt_id from label_prompts where jenis = 'lapus' and is_active limit 1;
  select id into v_pengeluaran_prompt_id from label_prompts where jenis = 'pengeluaran' and is_active limit 1;

  with base as (
    select
      n.id, n.title, n.source, n.url, n.publication_datetime, n.summary, n.content,
      n.screener_passed, n.lu_relevan, n.pengeluaran_relevan,
      n.kategori_lapus, n.komponen_pengeluaran,

      sflg.is_flagged as s_flagged, sflg.flag_reason as s_flag_reason,
      sll.hasil as s_hasil, sll.alasan as s_alasan, sll.prompt_version_id as s_prompt_version_id,
      (sqr.news_id is not null) as s_reviewed,

      lflg.is_flagged as l_flagged, lflg.flag_reason as l_flag_reason,
      lll.hasil as l_hasil, lll.alasan as l_alasan, lll.prompt_version_id as l_prompt_version_id,
      lll.batch_tag as l_batch_tag,
      (lqr.news_id is not null) as l_reviewed,

      pflg.is_flagged as p_flagged, pflg.flag_reason as p_flag_reason,
      pll.hasil as p_hasil, pll.alasan as p_alasan, pll.prompt_version_id as p_prompt_version_id,
      pll.batch_tag as p_batch_tag,
      (pqr.news_id is not null) as p_reviewed

    from news n
    left join lateral (
      select true as is_flagged, f.reason as flag_reason from labeling_flags f
      where f.news_id = n.id and f.jenis = 'screener' order by f.created_at desc limit 1
    ) sflg on true
    left join lateral (
      select l.hasil, l.hasil ->> 'alasan' as alasan, l.prompt_version_id from labeling_log l
      where l.news_id = n.id and l.jenis = 'screener' order by l.created_at desc limit 1
    ) sll on true
    left join labeling_qc_review sqr on sqr.news_id = n.id and sqr.jenis = 'screener'

    left join lateral (
      select true as is_flagged, f.reason as flag_reason from labeling_flags f
      where f.news_id = n.id and f.jenis = 'lapus' order by f.created_at desc limit 1
    ) lflg on true
    left join lateral (
      select l.hasil, l.hasil ->> 'alasan' as alasan, l.prompt_version_id, l.batch_tag from labeling_log l
      where l.news_id = n.id and l.jenis = 'lapus' order by l.created_at desc limit 1
    ) lll on true
    left join labeling_qc_review lqr on lqr.news_id = n.id and lqr.jenis = 'lapus'

    left join lateral (
      select true as is_flagged, f.reason as flag_reason from labeling_flags f
      where f.news_id = n.id and f.jenis = 'pengeluaran' order by f.created_at desc limit 1
    ) pflg on true
    left join lateral (
      select l.hasil, l.hasil ->> 'alasan' as alasan, l.prompt_version_id, l.batch_tag from labeling_log l
      where l.news_id = n.id and l.jenis = 'pengeluaran' order by l.created_at desc limit 1
    ) pll on true
    left join labeling_qc_review pqr on pqr.news_id = n.id and pqr.jenis = 'pengeluaran'
    where p_batch is null or n.batch = p_batch
  ),
  scored as (
    select b.*,
      coalesce(b.s_flagged, false) as s_is_flagged,
      (b.screener_passed is not null) as s_is_labeled,
      (b.screener_passed is not null and (v_screener_prompt_id is null or b.s_prompt_version_id is distinct from v_screener_prompt_id)) as s_needs_relabel,

      coalesce(b.l_flagged, false) as l_is_flagged,
      (b.lu_relevan is not null) as l_is_labeled,
      (b.lu_relevan is not null and (v_lapus_prompt_id is null or b.l_prompt_version_id is distinct from v_lapus_prompt_id)) as l_needs_relabel,

      coalesce(b.p_flagged, false) as p_is_flagged,
      (b.pengeluaran_relevan is not null) as p_is_labeled,
      (b.pengeluaran_relevan is not null and (v_pengeluaran_prompt_id is null or b.p_prompt_version_id is distinct from v_pengeluaran_prompt_id)) as p_needs_relabel
    from base b
  ),
  statused as (
    select s.*,
      (case
        when s_is_flagged then 'ditandai'
        when not s_is_labeled then 'belum'
        when s_needs_relabel then 'perlu_relabel'
        when not s_reviewed then 'perlu_review'
        else 'sudah_review'
      end) as s_status,
      (case
        when l_is_flagged then 'ditandai'
        when not l_is_labeled then 'belum'
        when l_needs_relabel then 'perlu_relabel'
        when not l_reviewed then 'perlu_review'
        else 'sudah_review'
      end) as l_status,
      (case
        when p_is_flagged then 'ditandai'
        when not p_is_labeled then 'belum'
        when p_needs_relabel then 'perlu_relabel'
        when not p_reviewed then 'perlu_review'
        else 'sudah_review'
      end) as p_status,
      -- "lengkap": Screener sudah diputuskan, dan kalau Lolos maka Lapus &
      -- Pengeluaran juga sudah dilabel (kalau Tidak Lolos, keduanya memang
      -- tidak perlu dikerjakan, jadi tetap "lengkap").
      (s_is_labeled and (coalesce(screener_passed, false) = false or (l_is_labeled and p_is_labeled))) as is_complete
    from scored s
  ),
  filtered as (
    select * from statused
    where (s_status in ('ditandai', 'perlu_relabel', 'perlu_review')
        or l_status in ('ditandai', 'perlu_relabel', 'perlu_review')
        or p_status in ('ditandai', 'perlu_relabel', 'perlu_review'))
      and coalesce(l_batch_tag, '') <> 'ml-screener'
      and coalesce(p_batch_tag, '') <> 'ml-screener'
      and (p_completeness is null
        or (p_completeness = 'lengkap' and is_complete)
        or (p_completeness = 'sebagian' and not is_complete))
      and (p_kondisi_label is null
        or (p_kondisi_label = 'lolos_tidak'
            and screener_passed is true
            and lu_relevan = 'Tidak'
            and pengeluaran_relevan = 'Tidak')
        or (p_kondisi_label = 'tidak_lolos' and screener_passed is false)
        or (p_kondisi_label = 'lolos_ya'
            and screener_passed is true
            and (lu_relevan = 'Ya' or pengeluaran_relevan = 'Ya')))
  ),
  paged as (
    select f.*, count(*) over () as total_count
    from filtered f
    order by f.publication_datetime desc, f.id desc
    limit p_page_size offset v_offset
  )
  select jsonb_build_object(
    'total', coalesce(max(p.total_count), 0),
    'rows', coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'title', p.title, 'source', p.source, 'url', p.url,
      'publication_datetime', p.publication_datetime,
      'summary', p.summary, 'content', p.content,
      'is_complete', p.is_complete,
      'screener', jsonb_build_object(
        'status', p.s_status, 'label_value',
          case when p.screener_passed is null then null when p.screener_passed then 'Lolos' else 'Tidak Lolos' end,
        'hasil', p.s_hasil, 'alasan', p.s_alasan, 'flag_reason', p.s_flag_reason
      ),
      'lapus', jsonb_build_object(
        'status', p.l_status, 'label_value', p.lu_relevan, 'kategori_lapus', p.kategori_lapus,
        'hasil', p.l_hasil, 'alasan', p.l_alasan, 'flag_reason', p.l_flag_reason
      ),
      'pengeluaran', jsonb_build_object(
        'status', p.p_status, 'label_value', p.pengeluaran_relevan, 'komponen_pengeluaran', p.komponen_pengeluaran,
        'hasil', p.p_hasil, 'alasan', p.p_alasan, 'flag_reason', p.p_flag_reason
      )
    )), '[]'::jsonb),
    'page', p_page,
    'page_size', p_page_size
  )
  into v_result
  from paged p;

  return v_result;
end;
$function$;
