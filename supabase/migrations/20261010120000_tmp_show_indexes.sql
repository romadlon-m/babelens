create or replace function tmp_show_indexes(p_table text)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_agg(jsonb_build_object('indexname', indexname, 'indexdef', indexdef))
  from pg_indexes where tablename = p_table;
$$;

grant execute on function tmp_show_indexes(text) to service_role;
