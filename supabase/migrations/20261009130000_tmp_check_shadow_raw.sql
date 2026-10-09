-- Temporary diagnostic, same pattern as CLAUDE.md's prior tmp_check_*/drop_tmp_* pairs.
-- Verifies admin_ml_shadow_raw()'s underlying query logic (array normalization, left
-- join to labeling_log, has_label filter) without the is_admin/auth.uid() gate, since
-- there's no authenticated session available from this shell. Dropped in the next migration.
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
        then array(select unnest(coalesce(ll.hasil -> v_category_key, '[]'::jsonb))::text order by 1)
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
