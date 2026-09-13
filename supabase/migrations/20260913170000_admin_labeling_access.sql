-- Lets admin accounts use the labeling tool themselves (to work through the queue,
-- or specifically to review/resolve a flagged row) — previously every RPC gate
-- checked `is_labeler` only, so an admin without that flag got "forbidden" even
-- after the page-level gate is loosened (see labeling-*.html / sidebar.js changes
-- alongside this migration).

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
        and not exists (select 1 from labeling_flags f where f.news_id = news.id and f.jenis = 'lapus')
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
        and not exists (select 1 from labeling_flags f where f.news_id = news.id and f.jenis = 'pengeluaran')
      order by publication_datetime asc
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

-- Direct-access counterpart to claim_next_news_for_labeling(): loads one exact
-- row instead of the oldest-in-queue one, ignoring both the flag exclusion (the
-- whole point of opening this is often to resolve a flagged row) and any existing
-- lock (deliberately overridden — a targeted admin/intern action, not a race
-- against the normal queue). Backs Detail Baris row clicks and, in principle, any
-- future "jump to this article" entry point.
create or replace function claim_specific_news_for_labeling(p_news_id bigint, p_jenis text)
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

  select * into v_row from news where id = p_news_id for update;
  if not found then
    raise exception 'news_id % tidak ditemukan', p_news_id;
  end if;

  if p_jenis = 'screener' then
    update news set screener_assigned_to = v_uid, screener_assigned_at = now() where id = p_news_id;
  elsif p_jenis = 'lapus' then
    update news set lapus_assigned_to = v_uid, lapus_assigned_at = now() where id = p_news_id;
  else
    update news set pengeluaran_assigned_to = v_uid, pengeluaran_assigned_at = now() where id = p_news_id;
  end if;

  select * into v_row from news where id = p_news_id;
  return v_row;
end;
$$;

revoke all on function claim_specific_news_for_labeling(bigint, text) from public;
grant execute on function claim_specific_news_for_labeling(bigint, text) to authenticated;

create or replace function flag_news_for_labeling(p_news_id bigint, p_jenis text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_is_labeler boolean;
  v_is_admin boolean;
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

  insert into labeling_flags (news_id, jenis, labeler_id, reason)
  values (p_news_id, p_jenis, v_uid, nullif(trim(p_reason), ''));

  if p_jenis = 'screener' then
    update news set screener_assigned_to = null, screener_assigned_at = null
      where id = p_news_id and screener_assigned_to = v_uid;
  elsif p_jenis = 'lapus' then
    update news set lapus_assigned_to = null, lapus_assigned_at = null
      where id = p_news_id and lapus_assigned_to = v_uid;
  else
    update news set pengeluaran_assigned_to = null, pengeluaran_assigned_at = null
      where id = p_news_id and pengeluaran_assigned_to = v_uid;
  end if;
end;
$$;

revoke all on function flag_news_for_labeling(bigint, text, text) from public;
grant execute on function flag_news_for_labeling(bigint, text, text) to authenticated;

-- submit_label now also clears any labeling_flags for this (news_id, jenis): a
-- successful submit means the row is no longer "stuck", most commonly via the
-- claim_specific_news_for_labeling() path used to resolve a flagged row directly.
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

  delete from labeling_flags where news_id = p_news_id and jenis = p_jenis;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function submit_label(bigint, text, uuid, jsonb, uuid, text) from public;
grant execute on function submit_label(bigint, text, uuid, jsonb, uuid, text) to service_role;
