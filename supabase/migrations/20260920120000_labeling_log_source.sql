-- Distinguishes real labeling submissions (from labeling-screener/lapus/
-- pengeluaran.html, the normal intern/labeler flow) from admin QC resubmits
-- (from admin-review.html's "Sesuai"/"Perbaiki" buttons on the "Perlu
-- direlabel" scope, which call the exact same submit_label() path to clear
-- the relabel flag) — both currently land in labeling_log identically, so
-- "Aktivitas Labeling" and "Progres saya" can't tell them apart. An admin
-- resubmitting an already-labeled row during review isn't new labeling work
-- and shouldn't count as such.
alter table labeling_log
  add column if not exists source text not null default 'labeling'
    check (source in ('labeling', 'review'));

-- Backfill: the normal queue (claim_next_news_for_labeling) can only ever
-- claim a row whose label column for that jenis is still null, so a labeler
-- working the regular queue can never produce a *second* labeling_log entry
-- for the same (news_id, jenis). The only paths that can are admin-review's
-- resubmit-on-review, or someone manually reopening an already-labeled row
-- via ?news_id=. Either way, "not the first real entry for this article+jenis"
-- is a reliable proxy for "this was a review/resubmit, not fresh labeling
-- work" — excludes relabel_reset_batch snapshots via batch_tag is null (those
-- already use a non-null batch_tag, see submit_label()'s migration history).
update labeling_log l
set source = 'review'
where l.batch_tag is null
  and exists (
    select 1 from labeling_log l2
    where l2.news_id = l.news_id
      and l2.jenis = l.jenis
      and l2.batch_tag is null
      and l2.created_at < l.created_at
  );

-- submit_label(): accept p_source, record it. Signature grows (trailing
-- param), so drop-then-create to avoid an ambiguous second overload from
-- PostgREST/RPC's named-parameter dispatch (same reasoning as every prior
-- signature change to admin_labeling_detail()).
drop function if exists submit_label(bigint, text, uuid, jsonb, uuid, text);

create function submit_label(
  p_news_id bigint,
  p_jenis text,
  p_labeler_id uuid,
  p_hasil jsonb,
  p_prompt_version_id uuid default null,
  p_batch_tag text default null,
  p_source text default 'labeling'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row news%rowtype;
  v_previous jsonb;
begin
  if p_jenis not in ('screener', 'lapus', 'pengeluaran') then
    raise exception 'jenis tidak valid: %', p_jenis;
  end if;
  if p_source not in ('labeling', 'review') then
    raise exception 'source tidak valid: %', p_source;
  end if;

  select * into v_row from news where id = p_news_id for update;
  if not found then
    raise exception 'news_id % tidak ditemukan', p_news_id;
  end if;

  if p_jenis = 'screener' then
    v_previous := jsonb_build_object('screener_passed', v_row.screener_passed);
    update news set
      screener_passed = (p_hasil->>'lolos')::boolean,
      screener_assigned_to = null,
      screener_assigned_at = null
    where id = p_news_id;

  elsif p_jenis = 'lapus' then
    v_previous := jsonb_build_object('lu_relevan', v_row.lu_relevan, 'kategori_lapus', v_row.kategori_lapus);
    update news set
      lu_relevan = p_hasil->>'relevan',
      kategori_lapus = case
        when p_hasil->'kategori' is null then null
        else (select array_agg(value::text) from jsonb_array_elements_text(p_hasil->'kategori') as value)
      end,
      lapus_assigned_to = null,
      lapus_assigned_at = null
    where id = p_news_id;

  else -- pengeluaran
    v_previous := jsonb_build_object('pengeluaran_relevan', v_row.pengeluaran_relevan, 'komponen_pengeluaran', v_row.komponen_pengeluaran);
    update news set
      pengeluaran_relevan = p_hasil->>'relevan',
      komponen_pengeluaran = case
        when p_hasil->'komponen' is null then null
        else (select array_agg(value::text) from jsonb_array_elements_text(p_hasil->'komponen') as value)
      end,
      pengeluaran_assigned_to = null,
      pengeluaran_assigned_at = null
    where id = p_news_id;
  end if;

  insert into labeling_log (news_id, jenis, labeler_id, hasil, previous_value, prompt_version_id, batch_tag, source)
  values (p_news_id, p_jenis, p_labeler_id, p_hasil, v_previous, p_prompt_version_id, p_batch_tag, p_source);

  delete from labeling_flags where news_id = p_news_id and jenis = p_jenis;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function submit_label(bigint, text, uuid, jsonb, uuid, text, text) from public;
grant execute on function submit_label(bigint, text, uuid, jsonb, uuid, text, text) to service_role;

-- labeling_my_progress(): exclude source='review' so an admin's own QC
-- resubmits don't inflate their "Progres saya" on the labeling pages —
-- signature unchanged, so create or replace is safe here.
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
  v_active_days bigint;
  v_last_active_date date;
  v_last_active_count bigint;
  v_avg_per_day numeric;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if p_jenis not in ('screener', 'lapus', 'pengeluaran') then
    raise exception 'jenis tidak valid: %', p_jenis;
  end if;

  v_today_start := date_trunc('day', now() at time zone 'Asia/Jakarta') at time zone 'Asia/Jakarta';

  select count(*) into v_total from labeling_log
  where labeler_id = v_uid and jenis = p_jenis and source = 'labeling';

  select count(*) into v_today from labeling_log
  where labeler_id = v_uid and jenis = p_jenis and source = 'labeling' and created_at >= v_today_start;

  select
    count(distinct (created_at at time zone 'Asia/Jakarta')::date),
    max((created_at at time zone 'Asia/Jakarta')::date)
  into v_active_days, v_last_active_date
  from labeling_log
  where labeler_id = v_uid and jenis = p_jenis and source = 'labeling';

  v_avg_per_day := case when v_active_days > 0 then round(v_total::numeric / v_active_days, 1) else 0 end;

  if v_last_active_date is not null then
    select count(*) into v_last_active_count from labeling_log
    where labeler_id = v_uid and jenis = p_jenis and source = 'labeling'
      and (created_at at time zone 'Asia/Jakarta')::date = v_last_active_date;
  else
    v_last_active_count := 0;
  end if;

  return jsonb_build_object(
    'total', v_total,
    'today', v_today,
    'last_active_date', v_last_active_date,
    'last_active_count', v_last_active_count,
    'active_days', v_active_days,
    'avg_per_day', v_avg_per_day
  );
end;
$$;

revoke all on function labeling_my_progress(text) from public;
grant execute on function labeling_my_progress(text) to authenticated;
