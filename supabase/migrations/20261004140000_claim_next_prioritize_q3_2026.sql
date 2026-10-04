-- Prioritize the Triwulan III 2026 (Jul-Sep) Lapus/Pengeluaran backlog in the
-- actual claim queue, not just in the "Sprint Triwulan III 2026" progress badge
-- (see labeling_sprint_q3_2026_progress(), 20261004130000) -- that badge only
-- *displays* progress against this window, it never scoped which row
-- claim_next_news_for_labeling() actually hands out next, so labelers kept being
-- served newer (Oct 2026+) rows ahead of the sprint's own backlog.
--
-- Scope matches the badge exactly: any row with publication_datetime in
-- [2026-07-01, 2026-10-01), regardless of batch -- not just batch2, since the
-- badge's own total/done/remaining already counts batch1 and batch2 together (a
-- handful of batch1 Jul-Sep rows can still be outstanding too; draining the whole
-- window before moving to anything newer is the actual ask, not "batch2 only"
-- while leaving stray batch1 Jul-Sep rows to compete with Oct+ on equal footing).
--
-- Only the lapus/pengeluaran branches get this extra ORDER BY tier -- Screener for
-- this window is already 100% done (verified 2026-10-04,
-- news-scraper-babel/Q3_2026_COMPLETION_LABELING.md), so touching its branch would
-- be a no-op; left alone to keep this change minimal.
--
-- Temporary, same as the progress badge: revert this ORDER BY tier (drop this
-- migration's effect by restoring plain `order by publication_datetime desc`, i.e.
-- re-apply 20260921130000's version of this function) once the Jul-Sep 2026
-- backlog is cleared -- don't let a sprint-specific priority linger permanently.
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
  v_q3_from timestamptz := '2026-07-01';
  v_q3_to timestamptz := '2026-10-01';
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
            where l.news_id = news.id and l.jenis = 'lapus' and l.source = 'labeling' and l.batch_tag is null
          ))
        )
        and (lapus_assigned_to is null or lapus_assigned_at < now() - interval '25 minutes')
        and not exists (select 1 from labeling_flags f where f.news_id = news.id and f.jenis = 'lapus')
      order by
        (case when publication_datetime >= v_q3_from and publication_datetime < v_q3_to then 0 else 1 end) asc,
        publication_datetime desc
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
            where l.news_id = news.id and l.jenis = 'pengeluaran' and l.source = 'labeling' and l.batch_tag is null
          ))
        )
        and (pengeluaran_assigned_to is null or pengeluaran_assigned_at < now() - interval '25 minutes')
        and not exists (select 1 from labeling_flags f where f.news_id = news.id and f.jenis = 'pengeluaran')
      order by
        (case when publication_datetime >= v_q3_from and publication_datetime < v_q3_to then 0 else 1 end) asc,
        publication_datetime desc
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
