-- shadow_predict.py (news-scraper-babel) upserts into ml_shadow_predictions
-- (on_conflict news_id,jenis,model_version) so a rerun can update an existing row
-- for the same model_version instead of erroring. The original migration
-- (20261008100000_ml_shadow_predictions.sql) only granted service_role select+insert,
-- not update -- an upsert's ON CONFLICT DO UPDATE path needs UPDATE too, confirmed by
-- a real "permission denied for table ml_shadow_predictions" / "GRANT UPDATE ..." error
-- when running the script against production. Same category of bug as the RLS-without-
-- matching-GRANT issue already documented repeatedly in CLAUDE.md -- just one privilege
-- short this time instead of missing the grant entirely.
grant update on ml_shadow_predictions to service_role;
