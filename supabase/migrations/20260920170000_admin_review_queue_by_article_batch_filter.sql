-- Adds a Batch 1 (belum pernah dilabel sama sekali) / Batch 2 (data lama
-- Copilot) filter to the Review Label per-article queue, same predicate as
-- labeling_queue_count_by_batch()/admin_labeling_detail()'s p_batch — an
-- article is Batch 1 if BOTH lu_relevan and pengeluaran_relevan are still
-- null, Batch 2 if either is already filled. Requested so the admin can
-- focus review effort on Batch 1 first. Signature grows (trailing param),
-- so drop-then-create like every other signature change to these functions
-- (avoids an ambiguous second overload from PostgREST/RPC's named-parameter
-- dispatch).
drop function if exists admin_review_queue_by_article(int, int, text);

create function admin_review_queue_by_article(
  p_page int default 1,
  p_page_size int default 10,
  p_completeness text default null,
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
      (lqr.news_id is not null) as l_reviewed,

      pflg.is_flagged as p_flagged, pflg.flag_reason as p_flag_reason,
      pll.hasil as p_hasil, pll.alasan as p_alasan, pll.prompt_version_id as p_prompt_version_id,
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
      select l.hasil, l.hasil ->> 'alasan' as alasan, l.prompt_version_id from labeling_log l
      where l.news_id = n.id and l.jenis = 'lapus' order by l.created_at desc limit 1
    ) lll on true
    left join labeling_qc_review lqr on lqr.news_id = n.id and lqr.jenis = 'lapus'

    left join lateral (
      select true as is_flagged, f.reason as flag_reason from labeling_flags f
      where f.news_id = n.id and f.jenis = 'pengeluaran' order by f.created_at desc limit 1
    ) pflg on true
    left join lateral (
      select l.hasil, l.hasil ->> 'alasan' as alasan, l.prompt_version_id from labeling_log l
      where l.news_id = n.id and l.jenis = 'pengeluaran' order by l.created_at desc limit 1
    ) pll on true
    left join labeling_qc_review pqr on pqr.news_id = n.id and pqr.jenis = 'pengeluaran'
    where p_batch is null
      or (p_batch = 'batch1' and n.lu_relevan is null and n.pengeluaran_relevan is null)
      or (p_batch = 'batch2' and (n.lu_relevan is not null or n.pengeluaran_relevan is not null))
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
      and (p_completeness is null
        or (p_completeness = 'lengkap' and is_complete)
        or (p_completeness = 'sebagian' and not is_complete))
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
$$;

revoke all on function admin_review_queue_by_article(int, int, text, text) from public;
grant execute on function admin_review_queue_by_article(int, int, text, text) to authenticated;
