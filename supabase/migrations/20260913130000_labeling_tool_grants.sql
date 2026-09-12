-- Fix: label_prompts_select_authenticated / labeling_log_select_admin policies were
-- created, but Supabase's default privileges never granted the underlying SELECT
-- table privilege to anon/authenticated for these two new tables (only TRUNCATE/
-- TRIGGER/REFERENCES were auto-granted). RLS policies are evaluated only after the
-- table-level GRANT check passes, so reads failed with "permission denied for table"
-- regardless of the policy being correct. Add the missing grants; RLS still narrows
-- what each role can actually see per the existing policies.

grant select on label_prompts to authenticated;
grant select on labeling_log to authenticated;
