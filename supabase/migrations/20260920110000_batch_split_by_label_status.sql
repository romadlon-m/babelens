-- Redefines "Batch 1 / Batch 2" from a publication-date cutoff to actual label
-- status. Checked against real data (2026-09-20): of the 23,442 pre-cutoff
-- rows sitting in the Screener queue, only 22,737 actually have lu_relevan/
-- pengeluaran_relevan already filled (the real legacy Copilot batch) — the
-- other 705 are genuinely blank rows that happen to predate LABEL_CUTOFF too,
-- so the date-based split silently miscounted them as "already labeled".
-- Status-based split matches exactly what claim_next_news_for_labeling()
-- already uses to order the Screener queue (blank rows before legacy-filled
-- ones) and what admin_labeling_detail() already exposes as `legacy_labeled`.
--
-- Batch 1 = genuinely never labeled (lu_relevan is null and pengeluaran_relevan
-- is null) — the real backlog that needs all 3 prompts run from scratch.
-- Batch 2 = legacy Copilot batch (lu_relevan or pengeluaran_relevan already
-- filled) — for Screener this is the ~22.7k rows needing screener_passed set;
-- for Lapus/Pengeluaran this will always show 0 in practice, since a row with
-- lu_relevan/pengeluaran_relevan already filled never enters those two queues
-- in the first place (claim_next_news_for_labeling requires that column to be
-- null) — that's expected, not a bug.
create or replace function labeling_queue_count_by_batch(p_jenis text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_is_labeler boolean;
  v_is_admin boolean;
  v_lock_cutoff timestamptz := now() - interval '25 minutes';
  v_batch1 integer;
  v_batch2 integer;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if p_jenis not in ('screener', 'lapus', 'pengeluaran') then
    raise exception 'jenis tidak valid: %', p_jenis;
  end if;

  select is_labeler, is_admin into v_is_labeler, v_is_admin from profiles where id = v_uid;
  if not (coalesce(v_is_labeler, false) or coalesce(v_is_admin, false)) then
    raise exception 'forbidden: akun ini bukan labeler atau admin';
  end if;

  if p_jenis = 'screener' then
    select
      count(*) filter (where n.lu_relevan is null and n.pengeluaran_relevan is null),
      count(*) filter (where n.lu_relevan is not null or n.pengeluaran_relevan is not null)
      into v_batch1, v_batch2
      from news n
      where n.screener_passed is null
        and (n.screener_assigned_to is null or n.screener_assigned_at < v_lock_cutoff)
        and not exists (select 1 from labeling_flags f where f.news_id = n.id and f.jenis = 'screener');
  elsif p_jenis = 'lapus' then
    select
      count(*) filter (where n.lu_relevan is null and n.pengeluaran_relevan is null),
      count(*) filter (where n.lu_relevan is not null or n.pengeluaran_relevan is not null)
      into v_batch1, v_batch2
      from news n
      where n.screener_passed = true and n.lu_relevan is null
        and (n.lapus_assigned_to is null or n.lapus_assigned_at < v_lock_cutoff)
        and not exists (select 1 from labeling_flags f where f.news_id = n.id and f.jenis = 'lapus');
  else
    select
      count(*) filter (where n.lu_relevan is null and n.pengeluaran_relevan is null),
      count(*) filter (where n.lu_relevan is not null or n.pengeluaran_relevan is not null)
      into v_batch1, v_batch2
      from news n
      where n.screener_passed = true and n.pengeluaran_relevan is null
        and (n.pengeluaran_assigned_to is null or n.pengeluaran_assigned_at < v_lock_cutoff)
        and not exists (select 1 from labeling_flags f where f.news_id = n.id and f.jenis = 'pengeluaran');
  end if;

  return jsonb_build_object('batch1', v_batch1, 'batch2', v_batch2);
end;
$$;

revoke all on function labeling_queue_count_by_batch(text) from public;
grant execute on function labeling_queue_count_by_batch(text) to authenticated;

-- admin_labeling_detail(): add p_batch ('batch1' | 'batch2' | null) filtering on
-- the same legacy_labeled expression it already computes and returns per row.
-- Signature grows, so drop-then-create like every prior change to this
-- function's params (avoids an ambiguous second overload from PostgREST/RPC's
-- named-parameter dispatch).
drop function if exists admin_labeling_detail(text, text, uuid, int, int, text, text, text, text, date, date, text, date, date);

create function admin_labeling_detail(
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
  p_prompt_versi text default null,
  p_submitted_from date default null,
  p_submitted_to date default null,
  p_batch text default null
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
  if p_batch is not null and p_batch not in ('batch1', 'batch2') then
    raise exception 'batch tidak valid: %', p_batch;
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
      n.id, n.title, n.source, n.publication_datetime, n.summary,
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
      ll.prompt_version_id,
      ll.submitted_at
    from news n
    left join lateral (
      select pr.nama as labeler_nama,
        l.hasil ->> 'alasan' as alasan,
        lp.versi as prompt_versi,
        l.prompt_version_id,
        l.created_at as submitted_at
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
    and (p_submitted_from is null or (ll.submitted_at at time zone 'Asia/Jakarta')::date >= p_submitted_from)
    and (p_submitted_to is null or (ll.submitted_at at time zone 'Asia/Jakarta')::date <= p_submitted_to)
    and (p_batch is null
      or (p_batch = 'batch1' and n.lu_relevan is null and n.pengeluaran_relevan is null)
      or (p_batch = 'batch2' and (n.lu_relevan is not null or n.pengeluaran_relevan is not null)))
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
      'summary', p.summary,
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

revoke all on function admin_labeling_detail(text, text, uuid, int, int, text, text, text, text, date, date, text, date, date, text) from public;
grant execute on function admin_labeling_detail(text, text, uuid, int, int, text, text, text, text, date, date, text, date, date, text) to authenticated;
