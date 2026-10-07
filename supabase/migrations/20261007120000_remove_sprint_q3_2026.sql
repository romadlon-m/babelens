-- Remove the temporary "Sprint Triwulan III 2026" feature (added 20261004130000/
-- 20261004140000, WIB-boundary-fixed in 20261004210000) -- per CLAUDE.md, this was
-- always meant to be cut once the Jul-Sep 2026 Lapus/Pengeluaran backlog was no
-- longer the priority, not left in permanently like a second LABEL_CUTOFF.
--
-- Reverts claim_next_news_for_labeling()'s lapus/pengeluaran ordering back to plain
-- newest-first (no Jul-Sep priority tier) -- every other predicate (queue exclusion,
-- soft-lock, flag exclusion, batch2 relabel-via-queue logic) is unchanged from
-- 20261004210000. Also drops labeling_sprint_q3_2026_progress(), which is no longer
-- called by anything once this ships.
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
            where l.news_id = news.id and l.jenis = 'lapus' and l.source = 'labeling' and l.batch_tag is null
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
            where l.news_id = news.id and l.jenis = 'pengeluaran' and l.source = 'labeling' and l.batch_tag is null
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

drop function if exists labeling_sprint_q3_2026_progress(text);
