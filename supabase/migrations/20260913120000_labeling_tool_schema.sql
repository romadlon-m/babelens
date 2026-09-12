-- Labeling tool (screener + lapus + pengeluaran): schema for Fase A.
-- See news-scraper-babel/LABELING_TOOL_PLAN.md (private repo) for full design rationale.

-- 4.1 Soft-lock / assignment columns on `news`, one pair per label jenis.
alter table news add column if not exists screener_passed boolean; -- NULL = belum discreening
alter table news add column if not exists screener_assigned_to uuid references profiles(id);
alter table news add column if not exists screener_assigned_at timestamptz;
alter table news add column if not exists lapus_assigned_to uuid references profiles(id);
alter table news add column if not exists lapus_assigned_at timestamptz;
alter table news add column if not exists pengeluaran_assigned_to uuid references profiles(id);
alter table news add column if not exists pengeluaran_assigned_at timestamptz;

-- Role flag for intern labeler accounts (separate from is_admin).
alter table profiles add column if not exists is_labeler boolean not null default false;

-- 4.2 Active prompt text per jenis, versioned so revising a prompt doesn't need a redeploy.
create table if not exists label_prompts (
  id uuid primary key default gen_random_uuid(),
  jenis text not null check (jenis in ('screener','lapus','pengeluaran')),
  versi text not null,
  isi_prompt text not null,
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);

-- Only one active prompt per jenis at a time.
create unique index if not exists label_prompts_one_active_per_jenis
  on label_prompts (jenis)
  where is_active;

-- 4.3 Audit trail + productivity source: every submit (and every relabel-reset snapshot).
create table if not exists labeling_log (
  id uuid primary key default gen_random_uuid(),
  news_id bigint not null references news(id),
  jenis text not null check (jenis in ('screener','lapus','pengeluaran')),
  labeler_id uuid not null references profiles(id),
  hasil jsonb not null,           -- {relevan, kategori/komponen, alasan, arah} atau {lolos, alasan}
  previous_value jsonb,           -- snapshot kolom terkait di `news` sebelum submit ini (null kalau baris baru)
  prompt_version_id uuid references label_prompts(id),
  batch_tag text,                 -- mis. 'relabel_2026_10', null untuk backlog biasa
  created_at timestamptz not null default now()
);

create index if not exists labeling_log_news_id_idx on labeling_log (news_id);
create index if not exists labeling_log_labeler_jenis_created_idx on labeling_log (labeler_id, jenis, created_at);

-- RLS: labelers/admin read prompts through the app; labeling_log is written only via the
-- submit_label() SECURITY DEFINER function (see the functions migration) and read only by
-- admins for the monitoring report — no direct client writes to either table.
alter table label_prompts enable row level security;
alter table labeling_log enable row level security;

drop policy if exists label_prompts_select_authenticated on label_prompts;
create policy label_prompts_select_authenticated
  on label_prompts for select
  to authenticated
  using (true);

drop policy if exists labeling_log_select_admin on labeling_log;
create policy labeling_log_select_admin
  on labeling_log for select
  to authenticated
  using (
    exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.is_admin
    )
  );
