-- admin_ml_shadow_queue_by_article()'s latest_screener/latest_lapus/latest_peng and
-- preds_latest CTEs all do `distinct on (...) ... order by ..., created_at/predicted_at
-- desc` -- the existing indexes (labeling_log_jenis_news_idx on (jenis, news_id),
-- ml_shadow_predictions_news_jenis_idx on (news_id, jenis)) don't cover that trailing
-- sort column, so Postgres falls back to a full sort per group. Observed directly:
-- the RPC's cold-cache runtime (first call after a while) sat right at the edge of
-- statement_timeout (5-8s, one call outright timed out) even after the base-population
-- optimization in 20261009180000 -- these indexes are the next lever, not a rewrite of
-- the query logic.
create index if not exists labeling_log_jenis_news_created_idx
  on labeling_log (jenis, news_id, created_at desc);

create index if not exists ml_shadow_predictions_news_jenis_predicted_idx
  on ml_shadow_predictions (news_id, jenis, predicted_at desc);
