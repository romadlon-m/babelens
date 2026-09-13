-- 1) service_role was missing SELECT on the 3 labeling-tool tables (the same class
-- of bug as 20260913130000 — an RLS policy is not a substitute for the base
-- table-level GRANT, and this applies per-role independently). This silently broke
-- submit-label's own lookup of "which prompt is currently active" (a plain
-- `.from('label_prompts').select('id')...` using the service-role client), so
-- every real submission recorded prompt_version_id = null without ever surfacing
-- an error — which then made every submitted row look like it "needs relabel"
-- even though it was labeled with the current prompt just moments earlier.
grant select on label_prompts to service_role;
grant select on labeling_log to service_role;
grant select on labeling_flags to service_role;

-- 2) Backfill: the 5 real submissions affected by the bug above (verified by hand —
-- batch_tag is null and hasil is a real payload, not a relabel_reset_batch snapshot,
-- which intentionally stores hasil = '{}' and should never get a prompt_version_id
-- backfilled onto it). Safe because each jenis has only ever had exactly one prompt
-- version active, ever — so "the currently active one" is unambiguously the one
-- that was in effect when these were submitted.
update labeling_log l
set prompt_version_id = lp.id
from label_prompts lp
where l.prompt_version_id is null
  and l.batch_tag is null
  and l.hasil <> '{}'::jsonb
  and lp.jenis = l.jenis
  and lp.is_active = true;

-- 3) admin_labeling_detail(): make 'ditandai' mutually exclusive from the other 3
-- statuses (previously a flagged-but-unlabeled row showed up under both 'belum'
-- and 'ditandai' at once, which is confusing when browsing by status) — now every
-- row falls into exactly one of belum/sudah/perlu_relabel/ditandai. Also adds
-- legacy_labeled: true when the row already has lu_relevan or pengeluaran_relevan
-- filled from the pre-tool manual labeling pass, regardless of jenis being viewed —
-- lets Detail Baris flag the "already has old lapus/pengeluaran data, screener
-- priority is lower" rows the Screener queue itself already deprioritizes (see
-- claim_next_news_for_labeling), so admins can see the same distinction.
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
  if p_status not in ('semua', 'belum', 'sudah', 'perlu_relabel', 'ditandai') then
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
      end as label_value,
      (n.lu_relevan is not null or n.pengeluaran_relevan is not null) as legacy_labeled,
      exists (
        select 1 from labeling_flags fl where fl.news_id = n.id and fl.jenis = p_jenis
      ) as is_flagged
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
      when 'belum' then not is_labeled and not is_flagged
      when 'sudah' then is_labeled and not needs_relabel and not is_flagged
      when 'perlu_relabel' then needs_relabel and not is_flagged
      when 'ditandai' then is_flagged
      else true
    end
  ),
  paged as (
    select f.*, count(*) over () as total_count
    from filtered f
    order by f.publication_datetime desc
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
      'labeler_nama', (
        select pr.nama from labeling_log l
        join profiles pr on pr.id = l.labeler_id
        where l.news_id = p.id and l.jenis = p_jenis
        order by l.created_at desc limit 1
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

revoke all on function admin_labeling_detail(text, text, uuid, int, int) from public;
grant execute on function admin_labeling_detail(text, text, uuid, int, int) to authenticated;
