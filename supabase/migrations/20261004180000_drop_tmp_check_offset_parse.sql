-- Cleanup: drop the throwaway diagnostic from 20261004170000 (confirmed the new
-- scraper date format "%Y-%m-%d %H:%M%z" parses correctly into the right UTC
-- instant — see babelens/CLAUDE.md and news-scraper-babel/CLAUDE.md for the full
-- publication_datetime timezone bug writeup).
drop function if exists tmp_check_offset_parse(text);
