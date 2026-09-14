-- labeling_log's only SELECT policy (labeling_log_select_admin, in
-- 20260913120000_labeling_tool_schema.sql) is admin-only — a regular labeler
-- querying it directly from the client would have RLS silently filter out every
-- row (no error, just an always-empty/zero result), not just admins-who-are-
-- viewing-others'-rows. So "progress saya" on the 3 labeling pages needs a
-- SECURITY DEFINER RPC scoped to auth.uid(), same pattern as
-- claim_next_news_for_labeling()/labeling_queue_count() already use to read
-- past what a labeler's own RLS grants allow.
--
-- "Today" is computed in Asia/Jakarta local time (WIB) regardless of the
-- database session's own timezone setting, since the labelers this is for are
-- all in Bangka Belitung (WIB) — date_trunc('day', now() at time zone
-- 'Asia/Jakarta') gives Jakarta midnight as a naive timestamp, then
-- `at time zone 'Asia/Jakarta'` again converts it back to a timestamptz for
-- comparison against `created_at`.
create or replace function labeling_my_progress(p_jenis text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_today_start timestamptz;
  v_total bigint;
  v_today bigint;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if p_jenis not in ('screener', 'lapus', 'pengeluaran') then
    raise exception 'jenis tidak valid: %', p_jenis;
  end if;

  v_today_start := date_trunc('day', now() at time zone 'Asia/Jakarta') at time zone 'Asia/Jakarta';

  select count(*) into v_total from labeling_log
  where labeler_id = v_uid and jenis = p_jenis;

  select count(*) into v_today from labeling_log
  where labeler_id = v_uid and jenis = p_jenis and created_at >= v_today_start;

  return jsonb_build_object('total', v_total, 'today', v_today);
end;
$$;

revoke all on function labeling_my_progress(text) from public;
grant execute on function labeling_my_progress(text) to authenticated;
