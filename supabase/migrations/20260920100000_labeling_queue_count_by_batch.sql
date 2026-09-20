-- Splits the labeling queue count into "Batch 1" (articles published after
-- LABEL_CUTOFF — the never-labeled-at-all backlog that grows daily via the
-- scraper) and "Batch 2" (the pre-cutoff ~22,810-row legacy batch, already
-- filled by the old Copilot pass but never run through screener_passed).
-- LABEL_CUTOFF is duplicated here as a literal to match the frontend constant
-- of the same name in dashboard.js/news-search.js (no shared config table) —
-- if that constant is ever bumped after a future labeling batch upload, this
-- function's literal needs to be bumped too.
--
-- Reuses the exact same WHERE predicate as labeling_queue_count() (including
-- the flag exclusion and the 25-minute soft-lock window) so the two numbers
-- can never disagree about what counts as "queued" — this just adds one more
-- AND clause splitting on publication_datetime.
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
  v_label_cutoff date := '2026-07-18';
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
      count(*) filter (where n.publication_datetime::date > v_label_cutoff),
      count(*) filter (where n.publication_datetime::date <= v_label_cutoff)
      into v_batch1, v_batch2
      from news n
      where n.screener_passed is null
        and (n.screener_assigned_to is null or n.screener_assigned_at < v_lock_cutoff)
        and not exists (select 1 from labeling_flags f where f.news_id = n.id and f.jenis = 'screener');
  elsif p_jenis = 'lapus' then
    select
      count(*) filter (where n.publication_datetime::date > v_label_cutoff),
      count(*) filter (where n.publication_datetime::date <= v_label_cutoff)
      into v_batch1, v_batch2
      from news n
      where n.screener_passed = true and n.lu_relevan is null
        and (n.lapus_assigned_to is null or n.lapus_assigned_at < v_lock_cutoff)
        and not exists (select 1 from labeling_flags f where f.news_id = n.id and f.jenis = 'lapus');
  else
    select
      count(*) filter (where n.publication_datetime::date > v_label_cutoff),
      count(*) filter (where n.publication_datetime::date <= v_label_cutoff)
      into v_batch1, v_batch2
      from news n
      where n.screener_passed = true and n.pengeluaran_relevan is null
        and (n.pengeluaran_assigned_to is null or n.pengeluaran_assigned_at < v_lock_cutoff)
        and not exists (select 1 from labeling_flags f where f.news_id = n.id and f.jenis = 'pengeluaran');
  end if;

  return jsonb_build_object('batch1', v_batch1, 'batch2', v_batch2, 'cutoff', v_label_cutoff);
end;
$$;

revoke all on function labeling_queue_count_by_batch(text) from public;
grant execute on function labeling_queue_count_by_batch(text) to authenticated;
