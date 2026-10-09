-- Temporary diagnostic: verify admin_ml_shadow_mark_reviewed() + the updated
-- admin_ml_shadow_queue_by_article() reviewed-staleness logic, without an authenticated
-- admin session. Dropped in the next migration.
create or replace function tmp_mark_reviewed(p_news_id bigint, p_jenis text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_jenis_list text[];
begin
  v_jenis_list := case p_jenis
    when 'screener' then array['screener']
    when 'lapus' then array['lapus', 'lapus_kategori']
    when 'pengeluaran' then array['pengeluaran', 'pengeluaran_kategori']
  end;
  update ml_shadow_predictions set reviewed_at = now()
  where news_id = p_news_id and jenis = any(v_jenis_list);
end;
$$;

grant execute on function tmp_mark_reviewed(bigint, text) to service_role;
