-- Admin per-row labeling detail view (drill-down from the Aktivitas Labeling recap).
-- Two parts: (1) partial indexes so both this new admin view and the existing intern
-- claim_next_news_for_labeling() queue queries stay fast as `news` grows, since
-- neither had any index on the screener_passed/lu_relevan/pengeluaran_relevan
-- nullability checks before this; (2) one paginated RPC that does filtering +
-- pagination + total count server-side in a single round trip, so the client never
-- has to pull the whole `news` table to filter/paginate in JS.

create index if not exists news_screener_queue_idx
  on news (publication_datetime)
  where screener_passed is null;

create index if not exists news_lapus_queue_idx
  on news (publication_datetime)
  where screener_passed = true and lu_relevan is null;

create index if not exists news_pengeluaran_queue_idx
  on news (publication_datetime)
  where screener_passed = true and pengeluaran_relevan is null;

create index if not exists labeling_log_jenis_news_idx
  on labeling_log (jenis, news_id);

-- Returns { total, rows, page, page_size } for one jenis at a time (screener/lapus/
-- pengeluaran each live on different `news` columns, so the view is always scoped to
-- one stage). p_status: 'semua' | 'belum' | 'sudah' | 'perlu_relabel'.
-- 'perlu_relabel' = already labeled but no labeling_log entry exists yet against the
-- currently active prompt for that jenis (covers both older-prompt relabels and rows
-- labeled before this tool/log existed at all).
-- p_labeler_id, when given, restricts to news rows that labeler has an entry for in
-- labeling_log for that jenis (used for the "click an intern's name" drill-down).
create or replace function admin_labeling_detail(
  p_jenis text,
  p_status text default 'semua',
  p_labeler_id uuid default null,
  p_page int default 1,
  p_page_size int default 25
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
  if p_status not in ('semua', 'belum', 'sudah', 'perlu_relabel') then
    raise exception 'status tidak valid: %', p_status;
  end if;

  p_page := greatest(coalesce(p_page, 1), 1);
  p_page_size := least(greatest(coalesce(p_page_size, 25), 1), 100);
  v_offset := (p_page - 1) * p_page_size;

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
      end as label_value
    from news n
    where p_labeler_id is null or exists (
      select 1 from labeling_log l
      where l.news_id = n.id and l.jenis = p_jenis and l.labeler_id = p_labeler_id
    )
  ),
  scored as (
    select s.*,
      s.is_labeled and (
        v_active_prompt_id is null or not exists (
          select 1 from labeling_log l2
          where l2.news_id = s.id and l2.jenis = p_jenis and l2.prompt_version_id = v_active_prompt_id
        )
      ) as needs_relabel
    from scoped s
  ),
  filtered as (
    select * from scored
    where case p_status
      when 'belum' then not is_labeled
      when 'sudah' then is_labeled
      when 'perlu_relabel' then needs_relabel
      else true
    end
  )
  select jsonb_build_object(
    'total', coalesce(max(f.total_count), 0),
    'rows', coalesce(jsonb_agg(f.row_json), '[]'::jsonb),
    'page', p_page,
    'page_size', p_page_size
  )
  into v_result
  from (
    select
      jsonb_build_object(
        'id', id, 'title', title, 'source', source,
        'publication_datetime', publication_datetime,
        'label_value', label_value, 'needs_relabel', needs_relabel
      ) as row_json,
      count(*) over () as total_count
    from filtered
    order by publication_datetime desc
    limit p_page_size offset v_offset
  ) f;

  return v_result;
end;
$$;

revoke all on function admin_labeling_detail(text, text, uuid, int, int) from public;
grant execute on function admin_labeling_detail(text, text, uuid, int, int) to authenticated;
