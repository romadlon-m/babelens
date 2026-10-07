-- claim_next_news_for_labeling()'s batch-2 "done" check for lapus/pengeluaran only
-- ever accepted a HUMAN labeling_log entry (source='labeling', batch_tag IS NULL)
-- as proof a row was relabeled -- an AI-Claude entry (batch_tag='ai-claude', written
-- by news-scraper-babel/scripts/ai_label.py) did not count, so a batch-2 row AI-Claude
-- had already relabeled kept getting served back into the human queue forever.
-- Found 2026-10-07 via a real example (news.id 22406): AI-Claude relabeled it for
-- lapus the same morning, but it still appeared at the top of labeling-lapus.html's
-- queue because no *human* batch_tag-null entry existed for that jenis.
--
-- Fix: a batch-2 row now counts as done for a jenis if EITHER a human (batch_tag IS
-- NULL) OR an ai-claude (batch_tag = 'ai-claude') labeling_log entry exists -- same
-- treatment batch 1 already gets implicitly (its relevan column is written directly
-- by submit_label() regardless of who/what submitted it, so there's no separate
-- "done" check to patch there).
--
-- labeling_queue_count() and labeling_queue_count_by_batch() are updated with the
-- identical predicate in the same migration -- per this project's own documented
-- invariant, the displayed "Sisa antrean" counts must never drift from what
-- claim_next_news_for_labeling() actually considers queued (a prior bug, fixed
-- 20260914130000, was exactly this kind of drift between sibling functions).
-- admin_labeling_detail()/admin_review_queue_by_article() are NOT touched here --
-- both already use a different, documented "perlu_relabel" definition keyed off the
-- active prompt version, not batch_tag, and are intentionally left to disagree (see
-- CLAUDE.md's "Batch 2 relabel flow").
create or replace function claim_next_news_for_labeling(p_jenis text)
returns news
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_is_labeler boolean;
  v_is_admin boolean;
  v_row news;
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
    select * into v_row from news
      where screener_passed is null
        and (screener_assigned_to is null or screener_assigned_at < now() - interval '25 minutes')
        and not exists (select 1 from labeling_flags f where f.news_id = news.id and f.jenis = 'screener')
      order by
        (case when lu_relevan is not null or pengeluaran_relevan is not null then 1 else 0 end) asc,
        publication_datetime desc
      limit 1
      for update skip locked;
    if found then
      update news set screener_assigned_to = v_uid, screener_assigned_at = now() where id = v_row.id;
    end if;
  elsif p_jenis = 'lapus' then
    select * into v_row from news
      where screener_passed = true
        and (
          lu_relevan is null
          or (batch = 'batch2' and not exists (
            select 1 from labeling_log l
            where l.news_id = news.id and l.jenis = 'lapus' and l.source = 'labeling'
              and (l.batch_tag is null or l.batch_tag = 'ai-claude')
          ))
        )
        and (lapus_assigned_to is null or lapus_assigned_at < now() - interval '25 minutes')
        and not exists (select 1 from labeling_flags f where f.news_id = news.id and f.jenis = 'lapus')
      order by publication_datetime desc
      limit 1
      for update skip locked;
    if found then
      update news set lapus_assigned_to = v_uid, lapus_assigned_at = now() where id = v_row.id;
    end if;
  else -- pengeluaran
    select * into v_row from news
      where screener_passed = true
        and (
          pengeluaran_relevan is null
          or (batch = 'batch2' and not exists (
            select 1 from labeling_log l
            where l.news_id = news.id and l.jenis = 'pengeluaran' and l.source = 'labeling'
              and (l.batch_tag is null or l.batch_tag = 'ai-claude')
          ))
        )
        and (pengeluaran_assigned_to is null or pengeluaran_assigned_at < now() - interval '25 minutes')
        and not exists (select 1 from labeling_flags f where f.news_id = news.id and f.jenis = 'pengeluaran')
      order by publication_datetime desc
      limit 1
      for update skip locked;
    if found then
      update news set pengeluaran_assigned_to = v_uid, pengeluaran_assigned_at = now() where id = v_row.id;
    end if;
  end if;

  return v_row;
end;
$$;

revoke all on function claim_next_news_for_labeling(text) from public;
grant execute on function claim_next_news_for_labeling(text) to authenticated;

create or replace function labeling_queue_count(p_jenis text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_is_labeler boolean;
  v_is_admin boolean;
  v_cutoff timestamptz := now() - interval '25 minutes';
  v_count integer;
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
    select count(*) into v_count from news n
      where n.screener_passed is null
        and (n.screener_assigned_to is null or n.screener_assigned_at < v_cutoff)
        and not exists (select 1 from labeling_flags f where f.news_id = n.id and f.jenis = 'screener');
  elsif p_jenis = 'lapus' then
    select count(*) into v_count from news n
      where n.screener_passed = true
        and (
          n.lu_relevan is null
          or (n.batch = 'batch2' and not exists (
            select 1 from labeling_log l
            where l.news_id = n.id and l.jenis = 'lapus' and l.source = 'labeling'
              and (l.batch_tag is null or l.batch_tag = 'ai-claude')
          ))
        )
        and (n.lapus_assigned_to is null or n.lapus_assigned_at < v_cutoff)
        and not exists (select 1 from labeling_flags f where f.news_id = n.id and f.jenis = 'lapus');
  else
    select count(*) into v_count from news n
      where n.screener_passed = true
        and (
          n.pengeluaran_relevan is null
          or (n.batch = 'batch2' and not exists (
            select 1 from labeling_log l
            where l.news_id = n.id and l.jenis = 'pengeluaran' and l.source = 'labeling'
              and (l.batch_tag is null or l.batch_tag = 'ai-claude')
          ))
        )
        and (n.pengeluaran_assigned_to is null or n.pengeluaran_assigned_at < v_cutoff)
        and not exists (select 1 from labeling_flags f where f.news_id = n.id and f.jenis = 'pengeluaran');
  end if;

  return v_count;
end;
$$;

revoke all on function labeling_queue_count(text) from public;
grant execute on function labeling_queue_count(text) to authenticated;

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
      count(*) filter (where n.batch = 'batch1'),
      count(*) filter (where n.batch = 'batch2')
      into v_batch1, v_batch2
      from news n
      where n.screener_passed is null
        and (n.screener_assigned_to is null or n.screener_assigned_at < v_lock_cutoff)
        and not exists (select 1 from labeling_flags f where f.news_id = n.id and f.jenis = 'screener');
  elsif p_jenis = 'lapus' then
    select
      count(*) filter (where n.batch = 'batch1'),
      count(*) filter (where n.batch = 'batch2')
      into v_batch1, v_batch2
      from news n
      where n.screener_passed = true
        and (
          n.lu_relevan is null
          or (n.batch = 'batch2' and not exists (
            select 1 from labeling_log l
            where l.news_id = n.id and l.jenis = 'lapus' and l.source = 'labeling'
              and (l.batch_tag is null or l.batch_tag = 'ai-claude')
          ))
        )
        and (n.lapus_assigned_to is null or n.lapus_assigned_at < v_lock_cutoff)
        and not exists (select 1 from labeling_flags f where f.news_id = n.id and f.jenis = 'lapus');
  else
    select
      count(*) filter (where n.batch = 'batch1'),
      count(*) filter (where n.batch = 'batch2')
      into v_batch1, v_batch2
      from news n
      where n.screener_passed = true
        and (
          n.pengeluaran_relevan is null
          or (n.batch = 'batch2' and not exists (
            select 1 from labeling_log l
            where l.news_id = n.id and l.jenis = 'pengeluaran' and l.source = 'labeling'
              and (l.batch_tag is null or l.batch_tag = 'ai-claude')
          ))
        )
        and (n.pengeluaran_assigned_to is null or n.pengeluaran_assigned_at < v_lock_cutoff)
        and not exists (select 1 from labeling_flags f where f.news_id = n.id and f.jenis = 'pengeluaran');
  end if;

  return jsonb_build_object('batch1', v_batch1, 'batch2', v_batch2);
end;
$$;

revoke all on function labeling_queue_count_by_batch(text) from public;
grant execute on function labeling_queue_count_by_batch(text) to authenticated;
