-- One-off backfill: correct the ~7-hour-ahead-of-true-UTC publication_datetime bug
-- (see babelens/CLAUDE.md "Bug found & fixed 2026-10-04: publication_datetime
-- stored 7 hours ahead of true UTC" and news-scraper-babel/CLAUDE.md for the
-- scraper-side root cause/fix). Every row up to and including id 56076 (the max
-- id at the moment this migration was authored, 2026-10-04, confirmed via direct
-- query before writing this) was written by the pre-fix scraper code -- its
-- publication_datetime holds the true WIB wall-clock digits mislabeled as UTC.
-- Any row with a higher id was written after the scraper fix landed and is
-- already correct, so must NOT be shifted again.
--
-- Verified before running: cross-checked day-of-week in several articles' own
-- text (explicit "Rabu (1/10)" etc.) against the raw stored digits across both
-- the oldest rows (id 1-10, Tribunnews/Antara, 2025-10-01) and recent batch2 rows
-- (RRI, 2026-09) -- all matched the bug's signature (stored digits = true WIB
-- digits, not true UTC), confirming a single uniform -7h shift is correct for
-- the entire affected range, not just recently-scraped sources.
--
-- This migration does NOT touch the 4 RPCs whose date-boundary comparisons
-- assumed the pre-backfill convention -- those are fixed in the migrations
-- immediately following this one in the same sequence (search this file's name
-- in CLAUDE.md for the full list). Applying this backfill without those fixes
-- landing in the same deploy would make every date-range filter in the app
-- wrong by up to 7 hours at day boundaries.
update news
set publication_datetime = publication_datetime - interval '7 hours'
where id <= 56076
  and publication_datetime is not null;
