-- Bounded retry counter for groq_processing_pipeline.py (news-scraper-babel).
--
-- Context: a total-failure row (every model in GROQ_MODELS exhausted, non-rate-limit)
-- used to be saved as is_processed=true with summary="Gagal memproses artikel." forever
-- — silently "done", never retried, needing a manual reset. This happened twice in 3
-- days (2026-09-24, see news-scraper-babel/CLAUDE.md) because the actual cause was a
-- dead/misconfigured fallback model, not broken content — a next-day retry would have
-- self-healed both incidents.
--
-- retry_count lets the pipeline retry a total failure up to 3 times across daily runs
-- (is_processed stays false, next cron run tries the full model chain again) before
-- giving up for good — bounded, so a row whose content is genuinely unprocessable
-- doesn't retry forever and waste API calls.
alter table public.news
  add column if not exists retry_count integer not null default 0;
