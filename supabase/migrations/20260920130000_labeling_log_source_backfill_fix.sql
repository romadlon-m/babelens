-- The 20260920120000 backfill heuristic ("this row has an earlier log entry
-- for the same news_id+jenis") caught 6 false positives from non-admin
-- labelers (JIHAN, NADIA, RAKA — all before admin-review.html even existed,
-- 2026-09-14/15/16): a genuine duplicate labeling submission by a labeler is
-- still real labeling work, not an admin QC review. The only code path that
-- actually produces source='review' going forward is admin-review.js, which
-- only admins can reach — so the backfill should require BOTH signals: an
-- earlier log entry for the same article+jenis, AND the submitter is an
-- admin. Re-derive `source` from scratch with the corrected heuristic rather
-- than patching just the 6 known rows, in case there are other
-- non-admin false positives not yet noticed.
update labeling_log l
set source = 'labeling'
where l.source = 'review'
  and not exists (
    select 1 from profiles p where p.id = l.labeler_id and p.is_admin
  );

update labeling_log l
set source = 'review'
where l.source = 'labeling'
  and l.batch_tag is null
  and exists (select 1 from profiles p where p.id = l.labeler_id and p.is_admin)
  and exists (
    select 1 from labeling_log l2
    where l2.news_id = l.news_id
      and l2.jenis = l.jenis
      and l2.batch_tag is null
      and l2.created_at < l.created_at
  );
