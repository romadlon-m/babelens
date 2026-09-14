-- Detail Baris: expose which prompt version produced each row's current
-- label, plus the label's own "alasan" text, and let admins filter by
-- prompt version. `labeling_log.prompt_version_id` has been recorded since
-- the tool's first migration (20260913120000) and already drives
-- `needs_relabel` internally, but was never surfaced to the client — an
-- admin had no way to see *which* version a "Sudah dilabel" row was
-- actually labeled under, only the derived yes/no "Perlu direlabel" flag.
-- Same for `labeling_log.hasil->>'alasan'`: recorded on every submit, never
-- returned by this RPC, even though "Detail Baris" is exactly the view an
-- admin would use to review why a labeler marked a row Lolos/Tidak Lolos or
-- Ya/Tidak.
--
-- Implementation notes:
-- - Replaces the two separate correlated subqueries (labeler_nama only) with
--   one LATERAL join to the row's latest labeling_log entry, since we now
--   need 3 fields (labeler_nama, alasan, prompt_versi) from that same latest
--   row rather than just 1.
-- - needs_relabel is simplified from "no log entry anywhere matches the
--   active prompt id" to "the latest log entry's prompt_version_id is not
--   the active one" — equivalent in practice (prompt versions only move
--   forward: a labeler cannot submit against a version that has already
--   been deactivated by a newer one), and now free since the lateral join
--   already carries prompt_version_id for the latest entry.
-- - p_prompt_versi is a new optional exact-match filter (closed vocabulary:
--   whatever versions exist in label_prompts for the selected jenis, same
--   pattern as p_label's closed vocabulary in admin-users.js).
-- - Same "drop then recreate" pattern as every prior signature change to
--   this function (see 20260914100000/20260914120000) — a new param makes a
--   new overload otherwise, which is ambiguous for Supabase's by-name RPC
--   resolution.
drop function if exists admin_labeling_detail(text, text, uuid, int, int, text, text, text, text, date, date);

create or replace function admin_labeling_detail(
  p_jenis text,
  p_status text default 'semua',
  p_labeler_id uuid default null,
  p_page int default 1,
  p_page_size int default 25,
  p_sort_col text default 'tanggal',
  p_sort_dir text default 'desc',
  p_label text default null,
  p_source text default null,
  p_date_from date default null,
  p_date_to date default null,
  p_prompt_versi text default null
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
  v_sort_col text;
  v_sort_dir text;
  v_source_pattern text;
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
  if p_status not in ('semua', 'belum', 'sudah', 'perlu_relabel', 'ditandai') then
    raise exception 'status tidak valid: %', p_status;
  end if;

  p_page := greatest(coalesce(p_page, 1), 1);
  p_page_size := least(greatest(coalesce(p_page_size, 25), 1), 100);
  v_offset := (p_page - 1) * p_page_size;

  v_sort_col := case p_sort_col
    when 'no' then 'id'
    when 'tanggal' then 'publication_datetime'
    when 'judul' then 'title'
    when 'sumber' then 'source'
    when 'label' then 'label_value'
    when 'labeler' then 'labeler_nama'
    when 'status' then 'status_text'
    else 'publication_datetime'
  end;
  v_sort_dir := case when lower(coalesce(p_sort_dir, 'desc')) = 'asc' then 'asc' else 'desc' end;

  if p_source is not null and length(trim(p_source)) > 0 then
    v_source_pattern := '%' || replace(trim(p_source), '%', '') || '%';
  end if;

  select id into v_active_prompt_id from label_prompts where jenis = p_jenis and is_active limit 1;

  with scoped as (
    select
      n.id, n.title, n.source, n.publication_datetime,
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
      (n.lu_relevan is not null or n.pengeluaran_relevan is not null) as legacy_labeled,
      exists (
        select 1 from labeling_flags fl where fl.news_id = n.id and fl.jenis = p_jenis
      ) as is_flagged,
      ll.labeler_nama,
      ll.alasan,
      ll.prompt_versi,
      ll.prompt_version_id
    from news n
    left join lateral (
      select pr.nama as labeler_nama,
        l.hasil ->> 'alasan' as alasan,
        lp.versi as prompt_versi,
        l.prompt_version_id
      from labeling_log l
      join profiles pr on pr.id = l.labeler_id
      left join label_prompts lp on lp.id = l.prompt_version_id
      where l.news_id = n.id and l.jenis = p_jenis
      order by l.created_at desc
      limit 1
    ) ll on true
    where (p_labeler_id is null or exists (
      select 1 from labeling_log l
      where l.news_id = n.id and l.jenis = p_jenis and l.labeler_id = p_labeler_id
    ))
    and (v_source_pattern is null or n.source ilike v_source_pattern)
    and (p_date_from is null or n.publication_datetime >= p_date_from::timestamptz)
    and (p_date_to is null or n.publication_datetime < (p_date_to + 1)::timestamptz)
    and (p_prompt_versi is null or ll.prompt_versi = p_prompt_versi)
  ),
  scored as (
    select s.*,
      s.is_labeled and (
        v_active_prompt_id is null or s.prompt_version_id is distinct from v_active_prompt_id
      ) as needs_relabel
    from scoped s
  ),
  filtered as (
    select sc.*,
      case
        when sc.is_flagged then 'Ditandai'
        when not sc.is_labeled then 'Belum dilabel'
        when sc.needs_relabel then 'Perlu direlabel'
        else 'Sudah dilabel'
      end as status_text
    from scored sc
    where (case p_status
      when 'belum' then not sc.is_labeled and not sc.is_flagged
      when 'sudah' then sc.is_labeled and not sc.needs_relabel and not sc.is_flagged
      when 'perlu_relabel' then sc.needs_relabel and not sc.is_flagged
      when 'ditandai' then sc.is_flagged
      else true
    end)
    and (p_label is null or sc.label_value = p_label)
  ),
  paged as (
    select f.*, count(*) over () as total_count
    from filtered f
    order by
      case when v_sort_col = 'id' and v_sort_dir = 'asc' then f.id end asc,
      case when v_sort_col = 'id' and v_sort_dir = 'desc' then f.id end desc,
      case when v_sort_col = 'publication_datetime' and v_sort_dir = 'asc' then f.publication_datetime end asc,
      case when v_sort_col = 'publication_datetime' and v_sort_dir = 'desc' then f.publication_datetime end desc,
      case when v_sort_col = 'title' and v_sort_dir = 'asc' then f.title end asc,
      case when v_sort_col = 'title' and v_sort_dir = 'desc' then f.title end desc,
      case when v_sort_col = 'source' and v_sort_dir = 'asc' then f.source end asc,
      case when v_sort_col = 'source' and v_sort_dir = 'desc' then f.source end desc,
      case when v_sort_col = 'label_value' and v_sort_dir = 'asc' then f.label_value end asc nulls last,
      case when v_sort_col = 'label_value' and v_sort_dir = 'desc' then f.label_value end desc nulls last,
      case when v_sort_col = 'labeler_nama' and v_sort_dir = 'asc' then f.labeler_nama end asc nulls last,
      case when v_sort_col = 'labeler_nama' and v_sort_dir = 'desc' then f.labeler_nama end desc nulls last,
      case when v_sort_col = 'status_text' and v_sort_dir = 'asc' then f.status_text end asc,
      case when v_sort_col = 'status_text' and v_sort_dir = 'desc' then f.status_text end desc,
      f.publication_datetime desc, f.id desc
    limit p_page_size offset v_offset
  )
  select jsonb_build_object(
    'total', coalesce(max(p.total_count), 0),
    'rows', coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'title', p.title, 'source', p.source,
      'publication_datetime', p.publication_datetime,
      'label_value', p.label_value, 'needs_relabel', p.needs_relabel,
      'legacy_labeled', p.legacy_labeled,
      'is_flagged', p.is_flagged,
      'flag_reason', case when p.is_flagged then (
        select reason from labeling_flags fl
        where fl.news_id = p.id and fl.jenis = p_jenis
        order by created_at desc limit 1
      ) else null end,
      'labeler_nama', p.labeler_nama,
      'alasan', p.alasan,
      'prompt_versi', p.prompt_versi
    )), '[]'::jsonb),
    'page', p_page,
    'page_size', p_page_size
  )
  into v_result
  from paged p;

  return v_result;
end;
$$;

revoke all on function admin_labeling_detail(text, text, uuid, int, int, text, text, text, text, date, date, text) from public;
grant execute on function admin_labeling_detail(text, text, uuid, int, int, text, text, text, text, date, date, text) to authenticated;
