-- labeling_queue_count() was missed by 20260913170000_admin_labeling_access.sql —
-- every other labeling-tool RPC gate (claim_next_news_for_labeling,
-- claim_specific_news_for_labeling, flag_news_for_labeling) was updated there to
-- accept is_admin OR is_labeler, but this one still checked is_labeler alone.
-- An admin account without is_labeler = true got "forbidden: akun ini bukan
-- labeler" every time the page loaded, which the client's catch block in
-- refreshQueueCount() (labeling-common.js) surfaces as "Sisa antrean: (gagal
-- memuat)" — indistinguishable in the UI from an actual outage, discovered only
-- by an admin actually testing the labeling pages themselves.
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
      where n.screener_passed = true and n.lu_relevan is null
        and (n.lapus_assigned_to is null or n.lapus_assigned_at < v_cutoff)
        and not exists (select 1 from labeling_flags f where f.news_id = n.id and f.jenis = 'lapus');
  else
    select count(*) into v_count from news n
      where n.screener_passed = true and n.pengeluaran_relevan is null
        and (n.pengeluaran_assigned_to is null or n.pengeluaran_assigned_at < v_cutoff)
        and not exists (select 1 from labeling_flags f where f.news_id = n.id and f.jenis = 'pengeluaran');
  end if;

  return v_count;
end;
$$;

revoke all on function labeling_queue_count(text) from public;
grant execute on function labeling_queue_count(text) to authenticated;
