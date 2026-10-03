-- New AI-derived classification field for groq_processing_pipeline.py (news-scraper-babel):
-- relevance to BPS indicators OTHER than PDRB (Inflasi/IHK, Pariwisata, Transportasi,
-- Kemiskinan, Ketimpangan Pengeluaran, Ekspor-Impor, IPM, Ketenagakerjaan, Luas Panen dan
-- Produksi Padi, Ketimpangan Gender, NTP, NTN, Sensus Penduduk/Ekonomi/Pertanian), or
-- ["Tidak Ada"]. See news-scraper-babel/CLAUDE.md "Rencana field baru 2026-10-03" for the
-- full token-cost and event_time-regression test history behind this field's prompt design.
--
-- Nullable with no default (not default '{}') — NULL means "not yet classified for this
-- field" (every row scraped before this field existed, plus any row that hits the
-- permanent-failure branch in run_processing()). A successfully processed row is never
-- NULL and never an empty array — it's always at least ["Tidak Ada"], same pattern as
-- event_time's "Tidak disebutkan" sentinel, so NULL unambiguously means "not processed"
-- rather than "processed, found nothing".
alter table public.news
  add column if not exists indikator_bps text[];
