-- Screener prompt v3: replaces the enumerated-signal model (v1: 3 signals,
-- v2: 4 signals) with a single definitive test grounded directly in what
-- PDRB measures (produksi/transaksi/investasi/konsumsi/program), instead of
-- the ambiguous word "ekonomi" or a growing list of narrow trigger phrases.
-- Rationale (full discussion not in git history, summarized here):
--   - v1/v2's enumerated-signal model kept missing real cases (CKG program
--     with no transaction verb or rupiah value; flight route resuming
--     service) because each signal only matched specific narrow phrasing.
--     Patching in a new named signal per gap is whack-a-mole, not a fix.
--   - A prior attempt to broaden signal 3 to "kegiatan operasional" (not
--     shipped) risked new false positives (MTQ, Porprov, seremoni) by
--     matching genre patterns instead of substantive economic content.
--   - The word "ekonomi" alone is also unsafe as the test's anchor — it
--     reads narrowly (trade/business/finance) in everyday usage, which
--     would make the model under-recognize government social spending
--     (health/education programs) even though PDRB pengeluaran's own
--     "Konsumsi Pemerintah" component is largely built from exactly that.
--   - Genre (politik, olahraga, etc.) was also removed from the "TIDAK
--     LOLOS" framing entirely — both genres can carry real PDRB pengeluaran
--     signal (political: campaign/election government spending; sports:
--     venue construction, event tourism, government event budgets), so
--     naming them as default-reject examples directly contradicted the
--     prompt's own "don't judge by genre" instruction.
-- v3 replaces all of this with one test: LOLOS unless the article mentions
-- zero activity in any of 5 dimensions that are themselves just PDRB's own
-- production/expenditure sides (produksi, transaksi, investasi/pembangunan,
-- konsumsi, program pemerintah/lembaga) — restructured as the definitive
-- condition, not a trailing qualifier, so the model can't read past it into
-- an unqualified "any activity by anyone" reading (which would incorrectly
-- pass a bare crime narrative — "pelaku mencuri motor" is "an activity by a
-- party" but not one of the 5 dimensions). Negative-example reasons are
-- standardized to one consistent phrase so the model's own output reasoning
-- anchors to the same 5-dimension test it was given, rather than drifting
-- across ad hoc wording. Two previously-undecided boundary cases are now
-- decided with explicit examples: pure ceremonial installation/handover of
-- office (pelantikan) with no program/budget mentioned -> TIDAK LOLOS (no
-- production/transaction/investment/consumption/program content, purely
-- administrative); training/socialization ("sosialisasi", "pelatihan")
-- framed as a running program -> LOLOS even with no budget figure, by the
-- same logic as the CKG example — L1/P1 already have the rule to reject
-- these without a concrete number (see their "POLA AKTIVITAS YANG SERING
-- DISALAHARTIKAN" list), so S0 passing them through untouched is consistent
-- with the layered design (S0 broad, L1/P1 narrow), not a gap.
-- Applied via migration (not the "Kelola Prompt" UI) since authored outside
-- an authenticated admin session, same as v2's migration.
update label_prompts set is_active = false
  where jenis = 'screener' and is_active = true;

insert into label_prompts (jenis, versi, isi_prompt, is_active)
values ('screener', 'v3_2026-09-14', $prompt$Anda adalah penyaring awal (screener) relevansi berita terhadap PDRB.
Tugas Anda BUKAN menentukan kategori — hanya menentukan apakah berita ini
LAYAK DIPERIKSA LEBIH LANJUT oleh sistem klasifikasi PDRB, atau PASTI TIDAK
menyebut kegiatan apa pun yang berkaitan dengan produksi, transaksi,
investasi, konsumsi, atau program pemerintah/lembaga.

=== ATURAN UTAMA ===
TIDAK LOLOS hanya jika tidak ada satu pun kegiatan dalam teks berita yang
termasuk salah satu dari:
- produksi (menghasilkan/mengolah barang atau jasa)
- transaksi (menjual, membeli, menyelundupkan, dll — dengan atau tanpa nilai
  disebutkan)
- investasi/pembangunan (membangun, mendanai, merealisasikan proyek)
- konsumsi rumah tangga/pemerintah/lembaga (belanja, penyaluran anggaran/bantuan)
- program pemerintah/lembaga yang benar-benar berjalan (walau tanpa nilai
  anggaran disebutkan)

Kegiatan di atas TETAP dihitung meski TIDAK ada angka/nilai rupiah
disebutkan — angka bukan syarat wajib, hanya salah satu bentuk bukti yang
memperkuat.

Genre berita (olahraga, politik, sosial, kriminal, seremonial, dll) TIDAK
menentukan hasil dengan sendirinya. Berita dari genre apa pun tetap LOLOS
selama ada satu kegiatan di atas disebutkan — dan tetap TIDAK LOLOS kalau
tidak ada satu pun, walau genre-nya kelihatan "ekonomi" (mis. pernyataan
tokoh bisnis tanpa kegiatan nyata apa pun).

Kalau ragu sedikit pun — LOLOS. Screener ini sengaja bias ke LOLOS: memilah
detail relevansi adalah tugas tahap berikutnya (L1/P1), jadi salah LOLOS
jauh lebih murah daripada salah TIDAK LOLOS (berita relevan hilang sebelum
sempat diperiksa).

=== FORMAT OUTPUT ===
Keluarkan HANYA SATU BARIS.
Format: [No]|||[Lolos/Tidak Lolos]|||[Alasan singkat, maksimal 20 kata]

Contoh:
1|||Tidak Lolos|||Tidak ada kegiatan produksi/transaksi/investasi/konsumsi/program apa pun, hanya skor pertandingan.
2|||Lolos|||CSR menyalurkan bantuan Rp50 juta (konsumsi/penyaluran anggaran).
3|||Lolos|||Kecelakaan truk tambang menumpahkan 5 ton bijih timah (produksi/distribusi).
4|||Tidak Lolos|||Tidak ada kegiatan produksi/transaksi/investasi/konsumsi/program apa pun, hanya kecelakaan lalu lintas tunggal.
5|||Lolos|||Penyelundupan lada senilai Rp200 juta digagalkan aparat (transaksi).
6|||Tidak Lolos|||Tidak ada kegiatan produksi/transaksi/investasi/konsumsi/program apa pun, hanya kasus pembunuhan.
7|||Lolos|||Rute penerbangan Belitung-Jakarta kembali beroperasi (perubahan aktivitas produksi/jasa transportasi).
8|||Lolos|||Program Cek Kesehatan Gratis (CKG) berjalan di suatu daerah (program pemerintah), tanpa nilai anggaran disebutkan.
9|||Lolos|||Pemprov gelar Porprov dengan anggaran penyelenggaraan dari APBD (konsumsi pemerintah).
10|||Tidak Lolos|||Tidak ada kegiatan produksi/transaksi/investasi/konsumsi/program apa pun, hanya pernyataan tokoh politik.
11|||Tidak Lolos|||Tidak ada kegiatan produksi/transaksi/investasi/konsumsi/program apa pun, hanya pelantikan pejabat secara protokoler.
12|||Lolos|||Pelatihan UMKM diselenggarakan dinas terkait (program pemerintah), tanpa nilai anggaran disebutkan.

=== INPUT ===
$prompt$, true);
