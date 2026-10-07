-- Temporary diagnostic RPC: verify whether the Q3 2026 (Jul-Sep, WIB) Lapus/Pengeluaran
-- backlog is actually 0, using the EXACT same "needs work" predicate
-- claim_next_news_for_labeling() uses (not the sprint RPC's separate, buggier "done"
-- definition) -- see CLAUDE.md task note on labeling_sprint_q3_2026_progress()'s
-- batch2 "done" predicate only accepting batch_tag IS NULL (human), undercounting
-- ai-claude-labeled rows as still-remaining.
-- Created to verify before removing the Sprint Triwulan III 2026 feature; drop immediately after use.
create or replace function tmp_check_q3_backlog()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'lapus_remaining_q3_window', (
      select count(*) from news n
      where n.screener_passed = true
        and n.publication_datetime >= '2026-07-01'::timestamp at time zone 'Asia/Jakarta'
        and n.publication_datetime < '2026-10-01'::timestamp at time zone 'Asia/Jakarta'
        and (
          n.lu_relevan is null
          or (n.batch = 'batch2' and not exists (
            select 1 from labeling_log l
            where l.news_id = n.id and l.jenis = 'lapus' and l.source = 'labeling' and l.batch_tag is null
          ))
        )
    ),
    'pengeluaran_remaining_q3_window', (
      select count(*) from news n
      where n.screener_passed = true
        and n.publication_datetime >= '2026-07-01'::timestamp at time zone 'Asia/Jakarta'
        and n.publication_datetime < '2026-10-01'::timestamp at time zone 'Asia/Jakarta'
        and (
          n.pengeluaran_relevan is null
          or (n.batch = 'batch2' and not exists (
            select 1 from labeling_log l
            where l.news_id = n.id and l.jenis = 'pengeluaran' and l.source = 'labeling' and l.batch_tag is null
          ))
        )
    ),
    'lapus_remaining_total' , (
      select count(*) from news n
      where n.screener_passed = true
        and (
          n.lu_relevan is null
          or (n.batch = 'batch2' and not exists (
            select 1 from labeling_log l
            where l.news_id = n.id and l.jenis = 'lapus' and l.source = 'labeling' and l.batch_tag is null
          ))
        )
    ),
    'pengeluaran_remaining_total', (
      select count(*) from news n
      where n.screener_passed = true
        and (
          n.pengeluaran_relevan is null
          or (n.batch = 'batch2' and not exists (
            select 1 from labeling_log l
            where l.news_id = n.id and l.jenis = 'pengeluaran' and l.source = 'labeling' and l.batch_tag is null
          ))
        )
    ),
    'lapus_remaining_q3_window_excl_ai_claude', (
      select count(*) from news n
      where n.screener_passed = true
        and n.publication_datetime >= '2026-07-01'::timestamp at time zone 'Asia/Jakarta'
        and n.publication_datetime < '2026-10-01'::timestamp at time zone 'Asia/Jakarta'
        and n.lu_relevan is null
    ),
    'pengeluaran_remaining_q3_window_excl_ai_claude', (
      select count(*) from news n
      where n.screener_passed = true
        and n.publication_datetime >= '2026-07-01'::timestamp at time zone 'Asia/Jakarta'
        and n.publication_datetime < '2026-10-01'::timestamp at time zone 'Asia/Jakarta'
        and n.pengeluaran_relevan is null
    )
  );
$$;

revoke all on function tmp_check_q3_backlog() from public;
grant execute on function tmp_check_q3_backlog() to service_role;
