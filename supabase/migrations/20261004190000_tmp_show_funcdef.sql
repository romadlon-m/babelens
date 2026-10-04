-- Throwaway diagnostic: dump the live source of functions we're about to modify,
-- so the timezone-boundary fix edits the actual current body (which signature/
-- logic may have drifted from what the migration history alone suggests) instead
-- of a guessed reconstruction. Dropped immediately after use.
create or replace function tmp_show_funcdef(p_name text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_oid oid;
  v_def text;
begin
  select oid into v_oid from pg_proc where proname = p_name and pronamespace = 'public'::regnamespace limit 1;
  if v_oid is null then
    return 'NOT FOUND';
  end if;
  select pg_get_functiondef(v_oid) into v_def;
  return v_def;
end;
$$;

grant execute on function tmp_show_funcdef(text) to anon, authenticated, service_role;
