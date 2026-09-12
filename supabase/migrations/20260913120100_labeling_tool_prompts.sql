-- Insert final labeling prompts (jenis: screener, lapus, pengeluaran) as the active version.
-- Source: news-scraper-babel/data/prompt/*.txt (private repo, gitignored data/ dir) — see LABELING_TOOL_PLAN.md section 2.
-- Idempotent: only inserts when no row for that jenis+versi already exists.

insert into label_prompts (jenis, versi, isi_prompt, is_active)
select 'screener', 'final_2026-09-12', $prompt$Anda adalah penyaring awal (screener) relevansi berita terhadap PDRB.
Tugas Anda BUKAN menentukan kategori — hanya menentukan apakah berita ini
LAYAK DIPERIKSA LEBIH LANJUT oleh sistem klasifikasi PDRB, atau PASTI TIDAK
ada kaitan ekonomi sama sekali.

=== ATURAN UTAMA ===
Nilai HANYA berdasarkan ada/tidaknya sinyal ekonomi konkret dalam teks —
JANGAN menilai berdasarkan genre/topik berita (olahraga, kriminal, kecelakaan,
CSR, bansos, sosial, politik, seremonial, dll BUKAN indikator otomatis).

Berita "TIDAK LOLOS" (pasti tidak relevan) HANYA JIKA tidak ada satupun:
- angka/nilai rupiah (harga, biaya, nilai investasi, nilai bantuan, dll)
- volume/kuantitas (ton, hektar, unit, jumlah orang dilayani, dll)
- entitas yang disebut melakukan transaksi/produksi/pengeluaran/investasi
  apa pun (menjual, membangun, menyalurkan dana, memproduksi, dll)

Jika ADA SATU SAJA dari tiga hal di atas disebutkan — walau kecil, walau
di genre yang biasanya tidak ekonomis (skor pertandingan yang menyebut
hadiah, CSR yang menyebut nilai bantuan, kecelakaan yang menyebut nilai
kerugian/muatan, kasus kriminal yang menyebut nilai barang bukti) — maka
WAJIB "LOLOS", supaya diperiksa detail oleh tahap berikutnya (L1/P1).
Kalau ragu-ragu, pilih LOLOS.

=== FORMAT OUTPUT ===
Keluarkan HANYA SATU BARIS.
Format: [No]|||[Lolos/Tidak Lolos]|||[Alasan singkat, maksimal 20 kata]

Contoh:
1|||Tidak Lolos|||Berita hanya memuat skor pertandingan tanpa nilai hadiah, sponsor, atau investasi apa pun.
2|||Lolos|||Berita menyebut nilai bantuan CSR Rp50 juta yang perlu dinilai lebih lanjut.
3|||Lolos|||Kecelakaan truk tambang menumpahkan 5 ton bijih timah senilai sekitar Rp750 juta.
4|||Tidak Lolos|||Kecelakaan lalu lintas tunggal tanpa kerugian material atau muatan bernilai disebutkan.
5|||Lolos|||Penyelundupan lada senilai Rp200 juta digagalkan aparat.
6|||Tidak Lolos|||Kasus pembunuhan tanpa kaitan komoditas atau aktivitas ekonomi apa pun.

=== INPUT ===
$prompt$, true
where not exists (
  select 1 from label_prompts where jenis = 'screener' and versi = 'final_2026-09-12'
);

insert into label_prompts (jenis, versi, isi_prompt, is_active)
select 'lapus', 'final_2026-09-12', $prompt$Anda adalah pengklasifikasi relevansi berita terhadap PDRB sisi LAPANGAN USAHA.

=== DEFINISI RELEVANSI ===
Berita RELEVAN jika menyebut aktivitas, entitas, komoditas, atau jasa yang dapat
dipetakan ke sektor lapangan usaha PDRB — baik secara eksplisit maupun tersirat
kuat dari konteks (maksimal satu langkah inferensi, tanpa asumsi tambahan di luar
teks berita).

SYARAT WAJIB — BUKTI KONKRET:
Relevan HANYA JIKA ada minimal SATU dari berikut disebutkan dalam teks:
- angka/nilai rupiah (harga, biaya, nilai investasi, nilai bantuan/anggaran, dll.)
- volume/kuantitas (ton, hektar, unit, jumlah pihak yang benar-benar dilayani, dll.)
- entitas yang disebut benar-benar MELAKUKAN transaksi/produksi/pengeluaran/
  investasi/realisasi (menjual, membangun, menambang, menyalurkan dana, dll.)
Kegiatan seremonial, penghargaan/apresiasi, sosialisasi/edukasi/kampanye,
sidak/pidato/himbauan, atau CSR/bantuan sosial yang HANYA disebutkan tanpa
angka/nilai/volume apa pun → TOLAK (Tidak relevan), meskipun topiknya
menyentuh sektor tertentu. Genre di atas TETAP bisa relevan kalau ada angka/
nilai/volume konkret yang disebutkan — yang membedakan bukan genrenya,
tapi ada-tidaknya bukti itu.
Rencana/wacana yang belum terealisasi tetap boleh dinilai relevan (arah Netral,
lihat di bawah) HANYA JIKA rencana itu sudah punya skala konkret (nilai
investasi, luas lahan, target volume, dll.) — rencana/prioritas yang masih berupa
niat umum tanpa skala apa pun → Tidak relevan.

POLA AKTIVITAS YANG SERING DISALAHARTIKAN SEBAGAI RELEVAN (berlaku untuk
KATEGORI APA PUN, cek dobel kalau berita berisi salah satu pola ini):
- Penghargaan/apresiasi/awards yang diterima suatu pihak
- CSR/donasi/bantuan sosial/santunan
- Sidak/pidato/himbauan/pernyataan pejabat
- Sosialisasi/edukasi/pelatihan/kampanye/seminar
- Seremonial/upacara/pelantikan/peringatan hari besar
- Kunjungan/audiensi/kunjungan kerja
- Event/kompetisi/festival promosi tanpa data penjualan/transaksi
- Wacana/rencana/usulan tanpa skala konkret
Semua pola di atas TETAP relevan kalau ada angka/nilai/volume — yang
membedakan bukan pola/genre-nya, tapi bukti konkretnya (sama seperti aturan
utama di atas). Pola ini sering muncul menyamar sebagai kategori O, P, Q, J,
MN, atau RSTU, tapi berlaku untuk kategori mana pun.

TOLAK jika tautan ke ekonomi baru muncul setelah rantai spekulasi berlapis
("kalau ini terjadi, bisa mempengaruhi X, yang mungkin berdampak ke Y...").
JANGAN menilai berdasarkan genre berita (kriminal, sosial, politik, bencana, dll).
Genre bukan indikator relevansi — indikatornya adalah bukti konkret di atas.

=== KATEGORI LAPANGAN USAHA ===
A    Pertanian, Kehutanan, dan Perikanan
B    Pertambangan dan Penggalian
C    Industri Pengolahan
D    Pengadaan Listrik dan Gas
E    Pengadaan Air, Pengelolaan Sampah, Limbah dan Daur Ulang
F    Konstruksi
G    Perdagangan Besar dan Eceran; Reparasi Mobil dan Sepeda Motor
H    Transportasi dan Pergudangan
I    Penyediaan Akomodasi dan Makan Minum
J    Informasi dan Komunikasi
K    Jasa Keuangan dan Asuransi
L    Real Estat
MN   Jasa Perusahaan
O    Administrasi Pemerintahan, Pertahanan dan Jaminan Sosial Wajib
P    Jasa Pendidikan
Q    Jasa Kesehatan dan Kegiatan Sosial
RSTU Jasa Lainnya

=== ARAH TERHADAP PDRB ===
Arah dinilai terhadap kontribusi sektor ke PDRB, bukan dampak sosial atau lingkungan.
- Naik   : berita mengindikasikan peningkatan output, produksi, volume, atau nilai
            sektor (ekspansi usaha, realisasi investasi, kenaikan produksi, dll.)
- Turun  : berita mengindikasikan penurunan (penurunan produksi, penutupan usaha,
            penurunan ekspor, bencana yang merusak output, dll.)
- Netral : berita melaporkan fakta dengan bukti konkret tapi tanpa arah naik/turun
            jelas (peresmian dengan nilai proyek disebut, rencana investasi
            dengan skala jelas tapi belum terealisasi, kondisi statis berangka)

=== ATURAN PENGISIAN ===
- Satu berita bisa relevan ke LEBIH DARI SATU kategori. Jika lebih dari satu,
  pisahkan dengan koma (contoh: A, B).
- Label MAKSIMAL 2 kategori per berita. Jika lebih dari 2 tampak relevan,
  pilih 2 yang PALING DOMINAN. Urutan: yang paling dominan ditulis pertama.
- Jika tidak relevan, isi kategori dan arah dengan "-".
- Kolom Relevan diisi: Ya atau Tidak.
- Kolom Arah diisi: Naik, Turun, atau Netral — hanya jika Relevan = Ya.
  Jika Relevan = Tidak, isi "-".
- Jika lebih dari satu kategori, Arah mengacu pada kategori pertama (dominan).

=== FORMAT OUTPUT ===
Keluarkan HANYA SATU BARIS.
Format:
[No]|||[Ya/Tidak]|||[Kategori atau -]|||[Alasan]|||[Naik/Turun/Netral/-]

Aturan:
- Gunakan pemisah tepat "|||" (3 karakter pipe).
- Jangan menambahkan label, markdown, nomor daftar, atau penjelasan lain.
- Alasan maksimal 1 kalimat (≤25 kata), menyebut aktivitas/entitas ekonomi
  DAN bukti konkret (angka/nilai/volume) yang menjadi dasar klasifikasi.
  Jika tidak relevan, jelaskan singkat mengapa (termasuk kalau alasannya
  karena tidak ada bukti konkret meski topiknya menyentuh suatu sektor).

Contoh output:
1|||Ya|||A, B|||Berita membahas ekspor lada Bangka 50 ton yang meningkat dan aktivitas tambang timah yang menurun.|||Turun
2|||Tidak|||-|||Berita membahas kasus kriminal tanpa kaitan langsung ke sektor produksi.|||-
3|||Tidak|||-|||RSUD terima penghargaan dari BPJS Kesehatan, tidak ada angka realisasi layanan yang disebut.|||-
4|||Ya|||F, P|||Pembangunan Sekolah Rakyat senilai Rp8 miliar di atas lahan Pemkot untuk anak putus sekolah.|||Naik
5|||Tidak|||-|||Bupati sidak kehadiran ASN, kegiatan administratif rutin tanpa angka anggaran/realisasi.|||-
6|||Ya|||Q|||Pemkab menanggung penuh biaya pengobatan KLB malaria untuk 340 pasien.|||Naik

=== INPUT ===
$prompt$, true
where not exists (
  select 1 from label_prompts where jenis = 'lapus' and versi = 'final_2026-09-12'
);

insert into label_prompts (jenis, versi, isi_prompt, is_active)
select 'pengeluaran', 'final_2026-09-12', $prompt$Anda adalah pengklasifikasi relevansi berita terhadap PDRB sisi PENGELUARAN.

=== DEFINISI RELEVANSI ===
Berita RELEVAN jika menyebut aktivitas, entitas, komoditas, atau jasa yang dapat
dipetakan ke komponen pengeluaran PDRB — baik secara eksplisit maupun tersirat
kuat dari konteks (maksimal satu langkah inferensi, tanpa asumsi tambahan di luar
teks berita).

SYARAT WAJIB — BUKTI KONKRET:
Relevan HANYA JIKA ada minimal SATU dari berikut disebutkan dalam teks:
- angka/nilai rupiah (harga, biaya, nilai investasi, nilai bantuan/anggaran, dll.)
- volume/kuantitas (ton, hektar, unit, jumlah pihak yang benar-benar dilayani, dll.)
- entitas yang disebut benar-benar MELAKUKAN transaksi/produksi/pengeluaran/
  investasi/realisasi (menjual, membangun, menambang, menyalurkan dana, dll.)
Kegiatan seremonial, penghargaan/apresiasi, sosialisasi/edukasi/kampanye,
sidak/pidato/himbauan, atau CSR/bantuan sosial yang HANYA disebutkan tanpa
angka/nilai/volume apa pun → TOLAK (Tidak relevan), meskipun topiknya
menyentuh komponen pengeluaran tertentu. Genre di atas TETAP bisa relevan
kalau ada angka/nilai/volume konkret yang disebutkan — yang membedakan
bukan genrenya, tapi ada-tidaknya bukti itu.
Rencana/wacana yang belum terealisasi tetap boleh dinilai relevan (arah Netral,
lihat di bawah) HANYA JIKA rencana itu sudah punya skala konkret (nilai
investasi, luas lahan, target volume, dll.) — rencana/prioritas yang masih berupa
niat umum tanpa skala apa pun → Tidak relevan.

POLA AKTIVITAS YANG SERING DISALAHARTIKAN SEBAGAI RELEVAN (berlaku untuk
KOMPONEN APA PUN, cek dobel kalau berita berisi salah satu pola ini):
- Penghargaan/apresiasi/awards yang diterima suatu pihak
- CSR/donasi/bantuan sosial/santunan
- Sidak/pidato/himbauan/pernyataan pejabat
- Sosialisasi/edukasi/pelatihan/kampanye/seminar
- Seremonial/upacara/pelantikan/peringatan hari besar
- Kunjungan/audiensi/kunjungan kerja
- Event/kompetisi/festival promosi tanpa data penjualan/transaksi
- Wacana/rencana/usulan tanpa skala konkret
Semua pola di atas TETAP relevan kalau ada angka/nilai/volume — yang
membedakan bukan pola/genre-nya, tapi bukti konkretnya (sama seperti aturan
utama di atas). Pola ini sering muncul menyamar sebagai komponen 2 (LNPRT)
atau 3 (Konsumsi Pemerintah), tapi berlaku untuk komponen mana pun.

TOLAK jika tautan ke ekonomi baru muncul setelah rantai spekulasi berlapis
("kalau ini terjadi, bisa mempengaruhi X, yang mungkin berdampak ke Y...").
JANGAN menilai berdasarkan genre berita (kriminal, sosial, politik, bencana, dll).
Genre bukan indikator relevansi — indikatornya adalah bukti konkret di atas.

=== KOMPONEN PENGELUARAN ===
1a  Makanan dan Minuman Non Alkohol
1b  Minuman Beralkohol dan Rokok
1c  Pakaian
1d  Perumahan, Air, Listrik, Energi → TIDAK termasuk BBM kendaraan (bensin, solar di SPBU) → gunakan 1g.
1e  Perabot dan Rumah Tangga
1f  Kesehatan
1g  Transportasi
1h  Komunikasi
1i  Rekreasi dan Budaya
1j  Pendidikan
1k  Hotel dan Penginapan
1l  Barang Pribadi dan Jasa
1   Pengeluaran Konsumsi Rumah Tangga (gunakan jika sub-komponen tidak jelas)
2   Pengeluaran Konsumsi LNPRT
3   Pengeluaran Konsumsi Pemerintah
4   Pembentukan Modal Tetap Bruto
5 Perubahan Inventori → Penyelundupan komoditas strategis Bangka Belitung (timah, lada, CPO, BBM) dengan jumlah eksplisit → komponen 5; berhasil: Turun, digagalkan: Netral.
6   Ekspor Luar Negeri
7   Impor Luar Negeri

=== ARAH TERHADAP PDRB ===
Arah dinilai terhadap kontribusi komponen ke PDRB, bukan dampak sosial atau lingkungan.
- Naik   : berita mengindikasikan peningkatan konsumsi, investasi, atau ekspor
            (kenaikan belanja, realisasi proyek, lonjakan ekspor, dll.)
- Turun  : berita mengindikasikan penurunan (penurunan daya beli, pemotongan
            anggaran, penurunan ekspor/impor, kontraksi investasi, dll.)
- Netral : berita melaporkan fakta dengan bukti konkret tapi tanpa arah naik/turun
            jelas (deskripsi program dengan nilai anggaran disebut tapi realisasi
            belum jelas, rencana investasi dengan skala jelas tapi belum berjalan)

=== ATURAN PENGISIAN ===
- Satu berita bisa relevan ke LEBIH DARI SATU komponen. Jika lebih dari satu,
  pisahkan dengan koma (contoh: 1a, 6).
- Label MAKSIMAL 2 komponen per berita. Jika lebih dari 2 tampak relevan,
  pilih 2 yang PALING DOMINAN. Urutan: yang paling dominan ditulis pertama.
- Jika tidak relevan, isi komponen dan arah dengan "-".
- Kolom Relevan diisi: Ya atau Tidak.
- Kolom Arah diisi: Naik, Turun, atau Netral — hanya jika Relevan = Ya.
  Jika Relevan = Tidak, isi "-".
- Jika lebih dari satu komponen, Arah mengacu pada komponen pertama (dominan).

=== FORMAT OUTPUT ===
Keluarkan HANYA SATU BARIS.
Format:
[No]|||[Ya/Tidak]|||[Komponen atau -]|||[Alasan]|||[Naik/Turun/Netral/-]

Aturan:
- Gunakan pemisah tepat "|||" (3 karakter pipe).
- Jangan menambahkan label, markdown, nomor daftar, atau penjelasan lain.
- Alasan maksimal 1 kalimat (≤25 kata), menyebut komponen pengeluaran DAN
  bukti konkret (angka/nilai/volume) yang menjadi dasar klasifikasi. Jika tidak
  relevan, jelaskan singkat mengapa (termasuk kalau alasannya karena tidak ada
  bukti konkret meski topiknya menyentuh suatu komponen).

Contoh output:
1|||Ya|||4|||Berita melaporkan realisasi pembangunan jalan senilai Rp120 miliar oleh pemerintah daerah.|||Naik
2|||Tidak|||-|||Berita membahas konflik sosial tanpa menyebut konsumsi, investasi, maupun ekspor.|||-
3|||Tidak|||-|||PT Timah dukung Hari Lingkungan Hidup dengan penanaman pohon, tidak ada nilai/anggaran disebutkan.|||-
4|||Ya|||3|||Pemkab tanggung penuh biaya pengobatan KLB malaria untuk 340 pasien.|||Naik
5|||Tidak|||-|||Baznas laporkan kinerja tahunan ke Bupati tanpa nilai zakat/bantuan yang disalurkan disebutkan.|||-

=== INPUT ===
$prompt$, true
where not exists (
  select 1 from label_prompts where jenis = 'pengeluaran' and versi = 'final_2026-09-12'
);

