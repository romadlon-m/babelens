-- Backs a new "Kelola Prompt" admin tab (admin-users.html) that lets admins view
-- and edit the 3 labeling prompts (screener/lapus/pengeluaran) without touching
-- SQL Editor directly.
--
-- Deliberately NOT a plain UPDATE of the active row's isi_prompt: label_prompts
-- is versioned on purpose (versi + is_active, with a partial unique index
-- enforcing one active row per jenis) so admin_labeling_detail()'s
-- "perlu_relabel" status can tell whether a row was labeled against the
-- *currently* active prompt. Editing isi_prompt in place on the same row would
-- silently invalidate that history — every labeling_log entry pointing at that
-- prompt_version_id (the row's own id) would retroactively describe a prompt
-- that no longer reads the way it did when the label was submitted, with no
-- audit trail of the change. So "save" here always deactivates the current
-- active row and inserts a new one, exactly like a hand-written SQL migration
-- would (see 20260913120100_labeling_tool_prompts.sql) — the UI just automates
-- that same pattern instead of replacing it. Reading prompts (including full
-- version history) needs no new RPC: label_prompts' existing SELECT policy
-- already allows any authenticated user to read all rows.
create or replace function admin_update_label_prompt(
  p_jenis text,
  p_isi_prompt text,
  p_versi text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_is_admin boolean;
  v_versi text;
  v_new_id uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  select is_admin into v_is_admin from profiles where id = v_uid;
  if not coalesce(v_is_admin, false) then
    raise exception 'forbidden: admin only';
  end if;
  if p_jenis not in ('screener', 'lapus', 'pengeluaran') then
    raise exception 'jenis tidak valid: %', p_jenis;
  end if;
  if p_isi_prompt is null or length(trim(p_isi_prompt)) = 0 then
    raise exception 'isi_prompt tidak boleh kosong';
  end if;

  v_versi := nullif(trim(p_versi), '');
  if v_versi is null then
    v_versi := to_char(now() at time zone 'Asia/Jakarta', 'YYYY-MM-DD_HH24MI');
  end if;

  -- Deactivate before insert, not after: label_prompts_one_active_per_jenis is a
  -- plain (immediate, not deferred) unique index, so a stray moment with 2 active
  -- rows for the same jenis would fail the insert outright.
  update label_prompts set is_active = false
    where jenis = p_jenis and is_active = true;

  insert into label_prompts (jenis, versi, isi_prompt, is_active)
  values (p_jenis, v_versi, p_isi_prompt, true)
  returning id into v_new_id;

  return jsonb_build_object('id', v_new_id, 'versi', v_versi);
end;
$$;

revoke all on function admin_update_label_prompt(text, text, text) from public;
grant execute on function admin_update_label_prompt(text, text, text) to authenticated;
