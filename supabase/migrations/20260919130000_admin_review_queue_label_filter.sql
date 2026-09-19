-- Menu Review Label: tambah filter Label (Lolos/Tidak Lolos untuk screener,
-- Ya/Tidak untuk lapus/pengeluaran) -- lihat CLAUDE.md "Menu Review Label
-- (admin)" bagian "Label filter" untuk alasan defaultnya "Tidak Lolos"/"Tidak"
-- (bukan "Semua"), supaya baris yang lebih berisiko menyembunyikan kesalahan
-- (false "tidak relevan") tidak tenggelam di antara baris "Lolos"/"Ya" yang
-- jauh lebih banyak. Signature bertambah -> drop-then-create, pola sama
-- seperti setiap perubahan parameter admin_labeling_detail() sebelumnya.
drop function if exists admin_review_queue(text, text, int, int);

create function admin_review_queue(
  p_jenis text,
  p_scope text,
  p_page int default 1,
  p_page_size int default 20,
  p_label text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_is_admin boolean;
  v_offset int;
  v_active_prompt_id uuid;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  select is_admin into v_is_admin from profiles where id = v_uid;
  if not coalesce(v_is_admin, false) then
    raise exception 'forbidden: admin only';
  end if;
  if p_jenis not in ('screener', 'lapus', 'pengeluaran') then
    raise exception 'jenis tidak valid: %', p_jenis;
  end if;
  if p_scope not in ('ditandai', 'perlu_relabel', 'sudah') then
    raise exception 'scope tidak valid: %', p_scope;
  end if;

  p_page := greatest(coalesce(p_page, 1), 1);
  p_page_size := least(greatest(coalesce(p_page_size, 20), 1), 50);
  v_offset := (p_page - 1) * p_page_size;

  select id into v_active_prompt_id from label_prompts where jenis = p_jenis and is_active limit 1;

  with base as (
    select
      n.id, n.title, n.source, n.url, n.publication_datetime, n.summary, n.content,
      case p_jenis
        when 'screener' then n.screener_passed is not null
        when 'lapus' then n.lu_relevan is not null
        else n.pengeluaran_relevan is not null
      end as is_labeled,
      case p_jenis
        when 'screener' then
          case when n.screener_passed is null then null
               when n.screener_passed then 'Lolos' else 'Tidak Lolos' end
        when 'lapus' then n.lu_relevan
        else n.pengeluaran_relevan
      end as label_value,
      n.kategori_lapus, n.komponen_pengeluaran,
      coalesce(flg.is_flagged, false) as is_flagged,
      flg.flag_reason,
      (qr.news_id is not null) as already_reviewed,
      ll.hasil,
      ll.alasan,
      ll.prompt_version_id
    from news n
    left join lateral (
      select true as is_flagged, f.reason as flag_reason
      from labeling_flags f
      where f.news_id = n.id and f.jenis = p_jenis
      order by f.created_at desc limit 1
    ) flg on true
    left join lateral (
      select l.hasil, l.hasil ->> 'alasan' as alasan, l.prompt_version_id
      from labeling_log l
      where l.news_id = n.id and l.jenis = p_jenis
      order by l.created_at desc
      limit 1
    ) ll on true
    left join labeling_qc_review qr on qr.news_id = n.id and qr.jenis = p_jenis
  ),
  scored as (
    select b.*,
      b.is_labeled and (
        v_active_prompt_id is null or b.prompt_version_id is distinct from v_active_prompt_id
      ) as needs_relabel
    from base b
  ),
  filtered as (
    select * from scored
    where case p_scope
      when 'ditandai' then is_flagged
      when 'perlu_relabel' then needs_relabel and not is_flagged
      else is_labeled and not needs_relabel and not is_flagged and not already_reviewed
    end
    and (p_label is null or label_value = p_label)
  ),
  paged as (
    select f.*, count(*) over () as total_count
    from filtered f
    order by f.publication_datetime asc, f.id asc
    limit p_page_size offset v_offset
  )
  select jsonb_build_object(
    'total', coalesce(max(p.total_count), 0),
    'rows', coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'title', p.title, 'source', p.source, 'url', p.url,
      'publication_datetime', p.publication_datetime,
      'summary', p.summary, 'content', p.content,
      'label_value', p.label_value,
      'kategori_lapus', p.kategori_lapus,
      'komponen_pengeluaran', p.komponen_pengeluaran,
      'flag_reason', p.flag_reason,
      'hasil', p.hasil,
      'alasan', p.alasan
    )), '[]'::jsonb),
    'page', p_page,
    'page_size', p_page_size
  )
  into v_result
  from paged p;

  return v_result;
end;
$$;

revoke all on function admin_review_queue(text, text, int, int, text) from public;
grant execute on function admin_review_queue(text, text, int, int, text) to authenticated;
