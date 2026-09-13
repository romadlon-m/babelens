-- "Flag as problematic" for the labeling tool: an intern hitting an AI response
-- that doesn't follow the expected format (observed in the 22k-row manual labeling
-- pass: articles about suicide/depression made Copilot answer with a sympathetic/
-- safety message instead of the structured line) previously only had "Lewati",
-- which just releases the soft-lock — the row goes straight back into the queue
-- and the next intern hits the exact same AI refusal again. A flag instead
-- permanently excludes the row from that stage's queue (no fabricated label ever
-- gets written) and surfaces it to admins for manual resolution.

create table if not exists labeling_flags (
  id uuid primary key default gen_random_uuid(),
  news_id bigint not null references news(id),
  jenis text not null check (jenis in ('screener', 'lapus', 'pengeluaran')),
  labeler_id uuid not null references profiles(id),
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists labeling_flags_news_jenis_idx on labeling_flags (news_id, jenis);

alter table labeling_flags enable row level security;

drop policy if exists labeling_flags_select_admin on labeling_flags;
create policy labeling_flags_select_admin
  on labeling_flags for select
  to authenticated
  using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin)
  );

-- Learned the hard way (20260913130000): an RLS policy alone is not enough, the
-- underlying table-level GRANT is also required or every select fails with
-- "permission denied for table", regardless of how correct the policy is.
grant select on labeling_flags to authenticated;

create or replace function flag_news_for_labeling(p_news_id bigint, p_jenis text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_is_labeler boolean;
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

-- claim_next_news_for_labeling replaced to also skip flagged rows (queue exclusion
-- lives here, next to the other queue predicates, rather than as an afterthought).
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

-- Centralizes "what counts as queued" (previously duplicated ad hoc in
-- labelingQueueCount() on the client) so the displayed queue count and the actual
-- claim query can never drift apart — now that flagged-row exclusion needs to apply
-- to both, keeping that logic in one place instead of two matters more.
create or replace function labeling_queue_count(p_jenis text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_is_labeler boolean;
  v_cutoff timestamptz := now() - interval '25 minutes';
  v_count integer;
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

-- admin_labeling_detail extended: expose is_flagged/flag_reason and a new
-- 'ditandai' status filter, so flagged rows are visible/manageable in Detail Baris.
create or replace function admin_labeling_detail(
  p_jenis text,
  p_status text default 'semua',
  p_labeler_id uuid default null,
  p_page int default 1,
  p_page_size int default 25
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_is_admin boolean;
  v_offset int;
  v_active_prompt_id uuid;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  select is_admin into v_is_admin from profiles where id = v_uid;
  if not coalesce(v_is_admin, false) then
    raise exception 'forbidden: admin only';
  end if;
  if p_jenis not in ('screener', 'lapus', 'pengeluaran') then
    raise exception 'jenis tidak valid: %', p_jenis;
  end if;
  if p_status not in ('semua', 'belum', 'sudah', 'perlu_relabel', 'ditandai') then
    raise exception 'status tidak valid: %', p_status;
  end if;

  p_page := greatest(coalesce(p_page, 1), 1);
  p_page_size := least(greatest(coalesce(p_page_size, 25), 1), 100);
  v_offset := (p_page - 1) * p_page_size;

  select id into v_active_prompt_id from label_prompts where jenis = p_jenis and is_active limit 1;

  with scoped as (
    select
      n.id, n.title, n.source, n.publication_datetime,
      case p_jenis
        when 'screener' then n.screener_passed is not null
        when 'lapus' then n.lu_relevan is not null
        else n.pengeluaran_relevan is not null
      end as is_labeled,
      case p_jenis
        when 'screener' then
          case when n.screener_passed is null then null
               when n.screener_passed then 'Lolos' else 'Tidak Lolos' end
        when 'lapus' then n.lu_relevan
        else n.pengeluaran_relevan
      end as label_value,
      exists (
        select 1 from labeling_flags fl where fl.news_id = n.id and fl.jenis = p_jenis
      ) as is_flagged
    from news n
    where p_labeler_id is null or exists (
      select 1 from labeling_log l
      where l.news_id = n.id and l.jenis = p_jenis and l.labeler_id = p_labeler_id
    )
  ),
  scored as (
    select s.*,
      s.is_labeled and (
        v_active_prompt_id is null or not exists (
          select 1 from labeling_log l2
          where l2.news_id = s.id and l2.jenis = p_jenis and l2.prompt_version_id = v_active_prompt_id
        )
      ) as needs_relabel
    from scoped s
  ),
  filtered as (
    select * from scored
    where case p_status
      when 'belum' then not is_labeled
      when 'sudah' then is_labeled
      when 'perlu_relabel' then needs_relabel
      when 'ditandai' then is_flagged
      else true
    end
  ),
  paged as (
    select f.*, count(*) over () as total_count
    from filtered f
    order by f.publication_datetime desc
    limit p_page_size offset v_offset
  )
  select jsonb_build_object(
    'total', coalesce(max(p.total_count), 0),
    'rows', coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'title', p.title, 'source', p.source,
      'publication_datetime', p.publication_datetime,
      'label_value', p.label_value, 'needs_relabel', p.needs_relabel,
      'is_flagged', p.is_flagged,
      'flag_reason', case when p.is_flagged then (
        select reason from labeling_flags fl
        where fl.news_id = p.id and fl.jenis = p_jenis
        order by created_at desc limit 1
      ) else null end
    )), '[]'::jsonb),
    'page', p_page,
    'page_size', p_page_size
  )
  into v_result
  from paged p;

  return v_result;
end;
$$;

revoke all on function admin_labeling_detail(text, text, uuid, int, int) from public;
grant execute on function admin_labeling_detail(text, text, uuid, int, int) to authenticated;
