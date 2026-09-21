-- Batch 2 (legacy Copilot-labeled rows, news.batch = 'batch2') relabel flow, "Opsi B":
--   * Screener runs on every batch 2 row (already the case: screener_passed is null
--     for all of them, so they were always in the Screener queue).
--   * Tidak Lolos on a batch 2 row -> lu_relevan / pengeluaran_relevan are forced to
--     'Tidak' and kategori/komponen/arah cleared (submit_label below).
--   * Lolos on a batch 2 row -> the row enters the Lapus/Pengeluaran queues even
--     though lu_relevan/pengeluaran_relevan are still filled, until a real
--     labeling_log entry (source = 'labeling', batch_tag is null) exists for that
--     row+jenis. The old label stays visible everywhere until the new submit
--     overwrites it; the old value is kept in labeling_log.previous_value.
-- No relabel_reset_batch() call is needed for this flow.

-- 1) claim_next_news_for_labeling(): lapus/pengeluaran eligibility widened.
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

-- 2) labeling_queue_count(): same predicate as the claim function above.
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
            where l.news_id = n.id and l.jenis = 'lapus' and l.source = 'labeling' and l.batch_tag is null
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
            where l.news_id = n.id and l.jenis = 'pengeluaran' and l.source = 'labeling' and l.batch_tag is null
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

-- 3) labeling_queue_count_by_batch(): now splits on the permanent news.batch column
-- (same predicate as the two functions above) instead of "is lu/pengeluaran filled",
-- which stopped meaning anything for Lapus/Pengeluaran once batch 2 rows enter
-- those queues with their old labels still in place. For Screener this is the same
-- split as before in practice (every batch 2 row is legacy-filled).
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
            where l.news_id = n.id and l.jenis = 'lapus' and l.source = 'labeling' and l.batch_tag is null
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
            where l.news_id = n.id and l.jenis = 'pengeluaran' and l.source = 'labeling' and l.batch_tag is null
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

-- 4) submit_label(): a Screener verdict of Tidak Lolos on a batch 2 row also forces
-- the (legacy) Lapus/Pengeluaran labels to 'Tidak' and clears kategori/komponen/arah,
-- so the row never says "no economic signal" and "Ya" at the same time. The old
-- values are included in this log entry's previous_value. Applies for any source
-- (a Review Label edit to Tidak Lolos on a batch 2 row should stay consistent too).
-- Signature unchanged, so create or replace is safe.
create or replace function submit_label(
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
  v_lolos boolean;
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
    v_lolos := (p_hasil->>'lolos')::boolean;
    v_previous := jsonb_build_object('screener_passed', v_row.screener_passed);
    update news set
      screener_passed = v_lolos,
      screener_assigned_to = null,
      screener_assigned_at = null
    where id = p_news_id;

    if v_lolos is false and v_row.batch = 'batch2' then
      v_previous := v_previous || jsonb_build_object(
        'lu_relevan', v_row.lu_relevan,
        'kategori_lapus', v_row.kategori_lapus,
        'arah_lapus', v_row.arah_lapus,
        'pengeluaran_relevan', v_row.pengeluaran_relevan,
        'komponen_pengeluaran', v_row.komponen_pengeluaran,
        'arah_pengeluaran', v_row.arah_pengeluaran
      );
      update news set
        lu_relevan = 'Tidak', kategori_lapus = null, arah_lapus = null,
        lapus_assigned_to = null, lapus_assigned_at = null,
        pengeluaran_relevan = 'Tidak', komponen_pengeluaran = null, arah_pengeluaran = null,
        pengeluaran_assigned_to = null, pengeluaran_assigned_at = null
      where id = p_news_id;
    end if;

  elsif p_jenis = 'lapus' then
    v_previous := jsonb_build_object('lu_relevan', v_row.lu_relevan, 'kategori_lapus', v_row.kategori_lapus, 'arah_lapus', v_row.arah_lapus);
    update news set
      lu_relevan = p_hasil->>'relevan',
      kategori_lapus = case
        when p_hasil->'kategori' is null then null
        else (select array_agg(value::text) from jsonb_array_elements_text(p_hasil->'kategori') as value)
      end,
      arah_lapus = p_hasil->>'arah',
      lapus_assigned_to = null,
      lapus_assigned_at = null
    where id = p_news_id;

  else -- pengeluaran
    v_previous := jsonb_build_object('pengeluaran_relevan', v_row.pengeluaran_relevan, 'komponen_pengeluaran', v_row.komponen_pengeluaran, 'arah_pengeluaran', v_row.arah_pengeluaran);
    update news set
      pengeluaran_relevan = p_hasil->>'relevan',
      komponen_pengeluaran = case
        when p_hasil->'komponen' is null then null
        else (select array_agg(value::text) from jsonb_array_elements_text(p_hasil->'komponen') as value)
      end,
      arah_pengeluaran = p_hasil->>'arah',
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
