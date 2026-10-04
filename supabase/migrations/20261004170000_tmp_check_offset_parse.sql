-- Throwaway diagnostic: confirm Postgres correctly parses the new scraper date
-- format ("%Y-%m-%d %H:%M%z", e.g. "2026-09-30 23:20+0700") into the right UTC
-- instant, before trusting the scraper fix. Dropped immediately after use.
create or replace function tmp_check_offset_parse(p_text text)
returns timestamptz
language sql
stable
as $$
  select p_text::timestamptz;
$$;

grant execute on function tmp_check_offset_parse(text) to anon, authenticated;
