-- Throwaway diagnostic: confirm the DB session's default timezone GUC, to verify
-- whether a naive timestamp string (no UTC offset) sent by the scraper is being
-- interpreted as UTC or as Asia/Jakarta when inserted into a timestamptz column.
-- Dropped again immediately after use -- see the next migration in this sequence.
create or replace function tmp_check_timezone()
returns text
language sql
stable
as $$
  select current_setting('TimeZone');
$$;

grant execute on function tmp_check_timezone() to anon, authenticated;
