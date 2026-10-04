-- Temporary sprint-progress RPC for the "Triwulan III 2026" (Jul-Sep) backlog
-- completion effort -- see news-scraper-babel/Q3_2026_COMPLETION_LABELING.md.
-- Screener for this window is already 100% done (verified 2026-10-04); only
-- Lapus and Pengeluaran remain, so this only supports those two jenis.
--
-- Deliberately scoped with a literal date range baked in, not a p_date_from/
-- p_date_to param from the client -- this sprint has exactly one fixed window.
-- This function (and its call sites in labeling-common.js / labeling-lapus.html /
-- labeling-pengeluaran.html) is meant to be dropped once the Jul-Sep 2026 backlog
-- is cleared, rather than lingering indefinitely the way the old LABEL_CUTOFF
-- constant did (see babelens/CLAUDE.md "LABEL_CUTOFF removed 2026-09-30").
--
-- "total"/"done"/"remaining" are all computed live on every call, not against a
-- frozen snapshot taken today -- so a resolved flag, a Review Label correction, or
-- any late-arriving row inside the window is reflected automatically next load,
-- with no code/UI change needed. Same reasoning as the LABEL_CUTOFF removal.
--
-- "done" for a jenis mirrors the exact negation of claim_next_news_for_labeling()'s
-- queue predicate for that jenis (see 20260921130000_batch2_relabel_via_queue.sql):
-- a batch1 row is done once its relevan column is filled; a batch2 row additionally
-- needs a real labeling_log entry (source='labeling', batch_tag is null) for this
-- jenis, since a batch2 row keeps its old legacy label (column already non-null)
-- until the tool-produced relabel actually overwrites it.
create or replace function labeling_sprint_q3_2026_progress(p_jenis text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_is_labeler boolean;
  v_is_admin boolean;
  v_date_from timestamptz := '2026-07-01';
  v_date_to timestamptz := '2026-10-01';
  v_total integer;
  v_done integer;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if p_jenis not in ('lapus', 'pengeluaran') then
    raise exception 'jenis tidak valid untuk sprint progress: %', p_jenis;
  end if;

  select is_labeler, is_admin into v_is_labeler, v_is_admin from profiles where id = v_uid;
  if not (coalesce(v_is_labeler, false) or coalesce(v_is_admin, false)) then
    raise exception 'forbidden: akun ini bukan labeler atau admin';
  end if;

  if p_jenis = 'lapus' then
    select
      count(*),
      count(*) filter (where n.lu_relevan is not null and (
        n.batch = 'batch1' or exists (
          select 1 from labeling_log l
          where l.news_id = n.id and l.jenis = 'lapus' and l.source = 'labeling' and l.batch_tag is null
        )
      ))
      into v_total, v_done
      from news n
      where n.screener_passed = true
        and n.publication_datetime >= v_date_from
        and n.publication_datetime < v_date_to;
  else
    select
      count(*),
      count(*) filter (where n.pengeluaran_relevan is not null and (
        n.batch = 'batch1' or exists (
          select 1 from labeling_log l
          where l.news_id = n.id and l.jenis = 'pengeluaran' and l.source = 'labeling' and l.batch_tag is null
        )
      ))
      into v_total, v_done
      from news n
      where n.screener_passed = true
        and n.publication_datetime >= v_date_from
        and n.publication_datetime < v_date_to;
  end if;

  return jsonb_build_object('total', v_total, 'done', v_done, 'remaining', v_total - v_done);
end;
$$;

revoke all on function labeling_sprint_q3_2026_progress(text) from public;
grant execute on function labeling_sprint_q3_2026_progress(text) to authenticated;
