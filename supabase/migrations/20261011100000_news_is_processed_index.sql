-- daily_pipeline.py's _count_unprocessed() does:
--   select('id', count='exact').eq('is_processed', False)
-- with no index on is_processed, this was a full sequential scan of the
-- entire (daily-growing) news table just to count a handful of false rows.
-- Confirmed directly against production 2026-10-11: 13 matching rows, 6.45s.
-- GitHub Actions' daily_scrape.yml run started failing with
-- "canceling statement due to statement timeout" (57014) on this exact query
-- once the table grew past whatever threshold the pooler's statement_timeout
-- allows. Partial index since is_processed=false is the rare case (most rows
-- are already true) -- keeps the index tiny regardless of table growth.
create index if not exists idx_news_is_processed_false
    on public.news (id)
    where is_processed = false;
