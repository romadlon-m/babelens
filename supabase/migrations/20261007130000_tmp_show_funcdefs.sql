create or replace function tmp_show_funcdefs()
returns table(name text, def text)
language sql
security definer
set search_path = public
as $$
  select 'claim_next_news_for_labeling', pg_get_functiondef('claim_next_news_for_labeling(text)'::regprocedure)
  union all
  select 'labeling_queue_count', pg_get_functiondef('labeling_queue_count(text)'::regprocedure)
  union all
  select 'labeling_queue_count_by_batch', pg_get_functiondef('labeling_queue_count_by_batch(text)'::regprocedure);
$$;

revoke all on function tmp_show_funcdefs() from public;
grant execute on function tmp_show_funcdefs() to service_role;
