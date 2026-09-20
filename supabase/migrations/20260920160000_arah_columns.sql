-- `arah` (Naik/Turun/Netral, direction of the PDRB-relevant activity) has
-- been part of the Lapus/Pengeluaran prompt spec since the labeling tool's
-- first migration (20260913120100), but was only ever stored inside
-- `labeling_log.hasil` (jsonb) — never written to `news`, so it could never
-- be surfaced in news-search cards, filtered, charted, or exported. Adds
-- dedicated columns and starts writing them from submit_label() going
-- forward, plus backfills from existing labeling_log history.
alter table news
  add column if not exists arah_lapus text check (arah_lapus in ('Naik', 'Turun', 'Netral')),
  add column if not exists arah_pengeluaran text check (arah_pengeluaran in ('Naik', 'Turun', 'Netral'));

-- Backfill from each article's latest real labeling_log entry per jenis
-- (batch_tag is null excludes relabel_reset_batch snapshots, same convention
-- used elsewhere in this schema) — 'Tidak' submissions have hasil.arah = null
-- already, so this naturally leaves arah_* null for those, matching how
-- kategori_lapus/komponen_pengeluaran already behave.
with latest_lapus as (
  select distinct on (news_id) news_id, hasil ->> 'arah' as arah
  from labeling_log
  where jenis = 'lapus' and batch_tag is null
  order by news_id, created_at desc
)
update news n set arah_lapus = l.arah
from latest_lapus l
where l.news_id = n.id and l.arah is not null;

with latest_pengeluaran as (
  select distinct on (news_id) news_id, hasil ->> 'arah' as arah
  from labeling_log
  where jenis = 'pengeluaran' and batch_tag is null
  order by news_id, created_at desc
)
update news n set arah_pengeluaran = p.arah
from latest_pengeluaran p
where p.news_id = n.id and p.arah is not null;

-- submit_label(): also write arah_lapus/arah_pengeluaran going forward.
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
