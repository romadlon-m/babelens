-- Labeling tool: RPC functions used by labeling-*.html / labeling.js and the
-- submit-label Edge Function. All SECURITY DEFINER so they can update `news`
-- (soft-lock columns, relevance/category columns) and insert into `labeling_log`
-- regardless of RLS, while still enforcing the is_labeler check themselves.

-- Atomically claim the next unlabeled/unlocked row for a given jenis, marking it
-- assigned to the caller. Uses SKIP LOCKED so two labelers never grab the same row.
create or replace function claim_next_news_for_labeling(p_jenis text)
returns news
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_is_labeler boolean;
  v_row news;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if p_jenis not in ('screener', 'lapus', 'pengeluaran') then
    raise exception 'jenis tidak valid: %', p_jenis;
  end if;

  select is_labeler into v_is_labeler from profiles where id = v_uid;
  if not coalesce(v_is_labeler, false) then
    raise exception 'forbidden: akun ini bukan labeler';
  end if;

  if p_jenis = 'screener' then
    select * into v_row from news
      where screener_passed is null
        and (screener_assigned_to is null or screener_assigned_at < now() - interval '25 minutes')
      order by publication_datetime asc
      limit 1
      for update skip locked;
    if found then
      update news set screener_assigned_to = v_uid, screener_assigned_at = now() where id = v_row.id;
    end if;
  elsif p_jenis = 'lapus' then
    select * into v_row from news
      where screener_passed = true and lu_relevan is null
        and (lapus_assigned_to is null or lapus_assigned_at < now() - interval '25 minutes')
      order by publication_datetime asc
      limit 1
      for update skip locked;
    if found then
      update news set lapus_assigned_to = v_uid, lapus_assigned_at = now() where id = v_row.id;
    end if;
  else -- pengeluaran
    select * into v_row from news
      where screener_passed = true and pengeluaran_relevan is null
        and (pengeluaran_assigned_to is null or pengeluaran_assigned_at < now() - interval '25 minutes')
      order by publication_datetime asc
      limit 1
      for update skip locked;
    if found then
      update news set pengeluaran_assigned_to = v_uid, pengeluaran_assigned_at = now() where id = v_row.id;
    end if;
  end if;

  return v_row; -- null (all columns null) when queue is empty
end;
$$;

revoke all on function claim_next_news_for_labeling(text) from public;
grant execute on function claim_next_news_for_labeling(text) to authenticated;

-- Release a soft-lock without submitting a label ("Lewati"). Only releases a lock
-- the caller themselves holds.
create or replace function release_news_lock(p_news_id bigint, p_jenis text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  if p_jenis = 'screener' then
    update news set screener_assigned_to = null, screener_assigned_at = null
      where id = p_news_id and screener_assigned_to = v_uid;
  elsif p_jenis = 'lapus' then
    update news set lapus_assigned_to = null, lapus_assigned_at = null
      where id = p_news_id and lapus_assigned_to = v_uid;
  elsif p_jenis = 'pengeluaran' then
    update news set pengeluaran_assigned_to = null, pengeluaran_assigned_at = null
      where id = p_news_id and pengeluaran_assigned_to = v_uid;
  else
    raise exception 'jenis tidak valid: %', p_jenis;
  end if;
end;
$$;

revoke all on function release_news_lock(bigint, text) from public;
grant execute on function release_news_lock(bigint, text) to authenticated;

-- Atomic submit: snapshot previous value into labeling_log, apply the new label to
-- `news`, and release the assignment lock for that jenis — all in one statement so
-- the submit-label Edge Function (which calls this via RPC using the service role)
-- never leaves `news` and `labeling_log` inconsistent if something fails partway.
-- Caller identity (labeler_id) is passed explicitly because the Edge Function calls
-- this using the service-role client (auth.uid() would be null there) after having
-- already verified the caller's JWT itself.
create or replace function submit_label(
  p_news_id bigint,
  p_jenis text,
  p_labeler_id uuid,
  p_hasil jsonb,
  p_prompt_version_id uuid default null,
  p_batch_tag text default null
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

  insert into labeling_log (news_id, jenis, labeler_id, hasil, previous_value, prompt_version_id, batch_tag)
  values (p_news_id, p_jenis, p_labeler_id, p_hasil, v_previous, p_prompt_version_id, p_batch_tag);

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function submit_label(bigint, text, uuid, jsonb, uuid, text) from public;
grant execute on function submit_label(bigint, text, uuid, jsonb, uuid, text) to service_role;

-- 4.5 Bulk relabel reset (Fase D): snapshot old values into labeling_log with a
-- batch_tag, then null out the label + lock columns so rows fall back into the
-- normal Screener queue. Admin-only, intended to be run manually (SQL editor or a
-- future admin-only RPC call) — not wired to any page yet, Fase D is out of scope
-- for this build.
create or replace function relabel_reset_batch(p_news_ids bigint[], p_batch_tag text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_is_admin boolean;
  v_count integer;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  select is_admin into v_is_admin from profiles where id = v_uid;
  if not coalesce(v_is_admin, false) then
    raise exception 'forbidden: admin only';
  end if;

  insert into labeling_log (news_id, jenis, labeler_id, hasil, previous_value, batch_tag)
  select n.id, 'screener', v_uid, '{}'::jsonb,
         jsonb_build_object('screener_passed', n.screener_passed), p_batch_tag
  from news n where n.id = any(p_news_ids);
  insert into labeling_log (news_id, jenis, labeler_id, hasil, previous_value, batch_tag)
  select n.id, 'lapus', v_uid, '{}'::jsonb,
         jsonb_build_object('lu_relevan', n.lu_relevan, 'kategori_lapus', n.kategori_lapus), p_batch_tag
  from news n where n.id = any(p_news_ids);
  insert into labeling_log (news_id, jenis, labeler_id, hasil, previous_value, batch_tag)
  select n.id, 'pengeluaran', v_uid, '{}'::jsonb,
         jsonb_build_object('pengeluaran_relevan', n.pengeluaran_relevan, 'komponen_pengeluaran', n.komponen_pengeluaran), p_batch_tag
  from news n where n.id = any(p_news_ids);

  update news set
    screener_passed = null, screener_assigned_to = null, screener_assigned_at = null,
    lu_relevan = null, kategori_lapus = null, lapus_assigned_to = null, lapus_assigned_at = null,
    pengeluaran_relevan = null, komponen_pengeluaran = null, pengeluaran_assigned_to = null, pengeluaran_assigned_at = null
  where id = any(p_news_ids);
  get diagnostics v_count = row_count;

  return v_count;
end;
$$;

revoke all on function relabel_reset_batch(bigint[], text) from public;
grant execute on function relabel_reset_batch(bigint[], text) to authenticated;
