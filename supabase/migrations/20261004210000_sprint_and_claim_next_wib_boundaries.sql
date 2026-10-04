-- Follow-up to the publication_datetime backfill (20261004200000): the Jul-Sep
-- 2026 boundaries in labeling_sprint_q3_2026_progress() and
-- claim_next_news_for_labeling()'s lapus/pengeluaran priority tier previously
-- worked only because the (pre-backfill) data's digits happened to equal true
-- WIB wall-clock digits mislabeled as UTC -- a plain `'2026-07-01'::timestamptz`
-- literal (parsed in the UTC session timezone) coincidentally matched the true
-- WIB calendar boundary. Now that publication_datetime is genuinely UTC, that
-- coincidence is gone: the literal needs to explicitly mean "2026-07-01 00:00
-- WIB", not "2026-07-01 00:00 UTC". `'...'::timestamp at time zone 'Asia/Jakarta'`
-- does exactly that, regardless of the DB session's own timezone setting --
-- same pattern admin_labeling_detail() already used correctly for
-- labeling_log.submitted_at (p_submitted_from/p_submitted_to), just applied in
-- the other direction here (converting a literal INTO timestamptz, not a stored
-- timestamptz OUT to a date).
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
  v_date_from timestamptz := '2026-07-01'::timestamp at time zone 'Asia/Jakarta';
  v_date_to timestamptz := '2026-10-01'::timestamp at time zone 'Asia/Jakarta';
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

-- Same fix, same reasoning, for the priority tier added in
-- 20261004140000_claim_next_prioritize_q3_2026.sql.
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
  v_q3_from timestamptz := '2026-07-01'::timestamp at time zone 'Asia/Jakarta';
  v_q3_to timestamptz := '2026-10-01'::timestamp at time zone 'Asia/Jakarta';
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
