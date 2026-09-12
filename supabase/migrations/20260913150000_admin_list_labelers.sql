-- Lets the admin's Detail Baris tab offer a proper "Intern" filter dropdown
-- (selectable directly, not only reachable by clicking through from Aktivitas
-- Labeling). profiles has no admin-readable RLS policy for other users' rows (see
-- comment in admin-users.js), so this is a small SECURITY DEFINER RPC in the same
-- pattern as the other admin_* functions.
create or replace function admin_list_labelers()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_is_admin boolean;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  select is_admin into v_is_admin from profiles where id = v_uid;
  if not coalesce(v_is_admin, false) then
    raise exception 'forbidden: admin only';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'nama', p.nama) order by p.nama), '[]'::jsonb)
  into v_result
  from profiles p
  where p.is_labeler;

  return v_result;
end;
$$;

revoke all on function admin_list_labelers() from public;
grant execute on function admin_list_labelers() to authenticated;
