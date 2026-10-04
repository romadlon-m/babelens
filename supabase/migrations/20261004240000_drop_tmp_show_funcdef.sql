-- Cleanup: drop the throwaway diagnostic from 20261004190000 (used to dump the
-- live definitions of admin_labeling_detail/dashboard_summary before editing
-- their date-boundary logic, so the fix edited the actual current body instead
-- of a guessed reconstruction from migration history).
drop function if exists tmp_show_funcdef(text);
