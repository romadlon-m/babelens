-- Fix: 20261009120000's kategori-array normalization used unnest(jsonb), which Postgres
-- doesn't support ("function unnest(jsonb) does not exist") -- found immediately via a
-- live test RPC (tmp_check_shadow_raw) before admin-ml-monitor.html was ever built, so
-- this never shipped broken to anything user-facing. jsonb_array_elements_text() is the
-- correct function to unnest a jsonb array into text rows (hasil.kategori/hasil.komponen
-- are stored as jsonb arrays, not Postgres text[], since labeling_log.hasil is jsonb).
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
$$;

grant execute on function admin_ml_shadow_summary(text, date, date) to authenticated;


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
$$;

grant execute on function admin_ml_shadow_disagreements(text, date, date, int, int) to authenticated;


create or replace function admin_ml_shadow_raw(
  p_jenis text,
  p_has_label boolean default null,
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
$$;

grant execute on function admin_ml_shadow_raw(text, boolean, date, date, int, int) to authenticated;


-- re-fix tmp diagnostic too, for re-testing before it's dropped.
create or replace function tmp_check_shadow_raw(
  p_jenis text,
  p_has_label boolean default null,
  p_page_size int default 5
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_log_jenis text;
  v_is_kategori boolean;
  v_category_key text;
  v_label_key text;
  v_total int;
  v_rows jsonb;
begin
  v_is_kategori := p_jenis in ('lapus_kategori', 'pengeluaran_kategori');
  v_log_jenis := case
    when p_jenis = 'lapus_kategori' then 'lapus'
    when p_jenis = 'pengeluaran_kategori' then 'pengeluaran'
    else p_jenis
  end;
  v_label_key := case when v_log_jenis = 'screener' then 'lolos' else 'relevan' end;
  v_category_key := case when v_log_jenis = 'lapus' then 'kategori' else 'komponen' end;

  with latest_log as (
    select distinct on (ll.news_id) ll.news_id, ll.hasil
    from labeling_log ll
    where ll.jenis = v_log_jenis and ll.source = 'labeling' and ll.hasil <> '{}'::jsonb
    order by ll.news_id, ll.created_at desc
  ),
  joined as (
    select
      sp.news_id, n.title, sp.predicted_relevan, sp.predicted_kategori, sp.predicted_arah,
      sp.predicted_at, (ll.news_id is not null) as has_label,
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
      and (p_has_label is null or (ll.news_id is not null) = p_has_label)
  )
  select
    (select count(*) from joined),
    (select jsonb_agg(jsonb_build_object(
        'news_id', news_id, 'has_label', has_label, 'predicted_relevan', predicted_relevan,
        'actual_relevan', actual_relevan, 'predicted_kategori', predicted_kategori,
        'actual_kategori', actual_kategori, 'predicted_arah', predicted_arah, 'actual_arah', actual_arah
      ) order by predicted_at desc)
      from (select * from joined order by predicted_at desc limit p_page_size) p)
  into v_total, v_rows;

  return jsonb_build_object('total', v_total, 'rows', coalesce(v_rows, '[]'::jsonb));
end;
$$;

grant execute on function tmp_check_shadow_raw(text, boolean, int) to service_role;
