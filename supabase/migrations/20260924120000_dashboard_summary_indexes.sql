-- Supporting indexes for dashboard_summary() (20260924110000). GIN indexes
-- let the unnest+group-by over kategori_lapus/komponen_pengeluaran use an
-- index scan instead of unnesting every row in the filtered range; btree on
-- region_final/event_time speed the wilayah/status group-bys. IF NOT EXISTS
-- since publication_datetime is very likely already indexed elsewhere in
-- this schema and we don't have a full dump of it to check without Docker.
create index if not exists idx_news_publication_datetime on public.news (publication_datetime);
create index if not exists idx_news_region_final on public.news (region_final);
create index if not exists idx_news_event_time on public.news (event_time);
create index if not exists idx_news_kategori_lapus_gin on public.news using gin (kategori_lapus);
create index if not exists idx_news_komponen_pengeluaran_gin on public.news using gin (komponen_pengeluaran);
