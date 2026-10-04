-- Cleanup: drop the throwaway diagnostic from 20261004150000 (confirmed DB
-- session TimeZone = 'UTC', used once to root-cause the publication_datetime
-- timezone bug — see babelens/CLAUDE.md and news-scraper-babel/CLAUDE.md).
drop function if exists tmp_check_timezone();
