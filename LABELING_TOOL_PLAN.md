# Rencana: Tool Labeling PDRB (Screener + Lapus + Pengeluaran)

Dokumen ini merangkum hasil diskusi (Sept 2026) untuk membangun tool web labeling PDRB
di babelens, menggantikan alur manual Google Sheets + GAS yang dipakai anak magang
sebelumnya. Ditulis supaya pengerjaan tabel & halaman bisa dilanjutkan di sesi/chat baru
tanpa perlu mengulang seluruh diskusi.

## 1. Latar belakang & masalah yang ditemukan

- Dataset labeling intern lama (6 file `data/02_Labeling_*.xlsx` di repo
  `news-scraper-babel`, digitignore) berisi **22.810 baris unik** (setelah dedup by URL),
  rentang tanggal 2025-10-01 s/d 2026-07-19.
- Kolom `Keterangan` (Isi/Edit/Hapus) di file itu **BUKAN sinyal QC** — itu cuma jejak
  script GAS internal untuk memonitor kecepatan copy-paste anak magang. Jangan dipakai
  sebagai indikator kualitas label.
- Analisis mandiri (baca manual + sampling stratified n=30 per kategori Lapus, total
  510 baris dibaca) menemukan **rate overreach (label "Ya" yang seharusnya "Tidak")
  bervariasi tajam per kategori**:
  - Sangat parah (50-87%): **O** (Administrasi Pemerintahan) 77%, **P** (Pendidikan) 87%,
    **Q** (Kesehatan) 57%, **J** (Informasi & Komunikasi) 53%, **MN** (Jasa Perusahaan) 50%,
    **RSTU** (Jasa Lainnya) 50%.
  - Sedang (15-30%): D (Listrik/Gas) ~30%, G (Perdagangan) ~17%, E (Air/Sampah) ~17%,
    K (Jasa Keuangan) ~17%.
  - Rendah (<15%): A, B, C, F, H, I, L.
  - Akar masalah: prompt lama mengizinkan "tersirat kuat, maksimal satu langkah
    inferensi" tanpa syarat bukti kuantitatif — sehingga genre seperti CSR/bansos,
    penghargaan, sidak/pidato, sosialisasi/edukasi, seremonial, kunjungan, dan
    event promosi tanpa data transaksi ikut ditandai "Ya" hanya karena topiknya
    menyentuh sebuah sektor, bukan karena ada aktivitas ekonomi nyata.
- Kesimpulan: **jangan restart dataset dari nol**, tapi jangan pula dipakai langsung
  untuk training — perlu prompt diperbaiki + seluruh dataset lama di-relabel ulang
  (lihat Alur Kerja di bawah), bukan cuma di-QC sebagian.
- Backlog belum berlabel di Supabase per momen diskusi ini: **~6.742 baris**
  (artikel terbit setelah 2026-07-19 s/d sekarang, `lu_relevan IS NULL`).
- File prompt (`data/prompt/*.txt` di `news-scraper-babel`) **ter-gitignore** (baris
  `data/` di `.gitignore`, sudah di-commit `ab0d221`) — sengaja, tapi berarti prompt
  final di bawah ini TIDAK ada di git history, cuma di working copy lokal. Prompt versi
  final disalin lengkap di bagian 2 dokumen ini sebagai cadangan.

## 2. Prompt final (sudah selesai, jangan direvisi lagi tanpa diskusi ulang)

Lokasi file: `news-scraper-babel/data/prompt/prompt_screener.txt`,
`prompt_lapus.txt`, `prompt_pengeluaran.txt` (semua sudah final per sesi ini).

Prinsip inti yang dipakai di ketiganya:
1. **Screener** menyaring lebih dulu — tugasnya cuma menjawab "ada sinyal ekonomi sama
   sekali atau tidak", genre-agnostic (skor olahraga tanpa hadiah = Tidak Lolos, tapi
   skor olahraga DENGAN hadiah Rp disebut = Lolos). Kalau ragu, WAJIB pilih Lolos.
2. **Lapus & Pengeluaran** mensyaratkan "bukti konkret" (angka rupiah, volume/kuantitas,
   atau entitas yang benar-benar melakukan transaksi/realisasi) sebelum dianggap relevan
   — genre (CSR, penghargaan, sidak, sosialisasi, seremonial, kunjungan, event promosi,
   wacana tanpa skala) TIDAK otomatis ditolak ATAU diterima, keputusannya murni dari ada/
   tidaknya bukti itu di teks.
3. Kedua prompt punya blok **"Pola aktivitas yang sering disalahartikan"** — daftar
   pola lintas-kategori (bukan catatan per-kategori) supaya berlaku ke kategori/komponen
   apa pun, bukan cuma yang sudah ketahuan bermasalah di sampel kemarin.

Isi lengkap ketiga prompt (final) ada di file aslinya — **jangan duplikat isi panjang
di sini**, cukup rujuk path di atas. Kalau file itu hilang, lihat riwayat percakapan
sesi ini (tanggal 2026-09-12) untuk teks lengkapnya.

## 3. Keputusan desain alur kerja

- **Role**: `is_labeler` (boolean baru di `profiles`) untuk anak magang. Reviewer/admin
  cukup `is_admin` yang sudah ada — tidak ada role terpisah untuk reviewer.
- **Halaman dipisah per jenis prompt** (Screener / Lapus / Pengeluaran) — BUKAN satu
  halaman yang mengerjakan ketiganya per baris. Alasan: risiko salah tempel hasil ke
  kolom yang salah (format keduanya mirip, validator tidak bisa mendeteksi kalau
  hasil Pengeluaran ditempel ke field Lapus, karena formatnya tetap valid).
- **Cara kerja intern**: satu jenis prompt dulu untuk SEMUA baris di antreannya, baru
  pindah ke jenis berikutnya — bukan 3 prompt langsung per baris per baris.
- **Tidak ada sistem "batch klaim"** — itu over-engineering untuk skala 4-5 intern.
  Cukup klaim otomatis per-baris dengan timeout (lihat skema di bagian 4).
- **Alasan disimpan di tabel terpisah** (`labeling_log`), bukan kolom baru di `news` —
  supaya gampang dibuang kalau tidak dibutuhkan lagi tanpa menyentuh tabel utama.
- **Tidak ada mekanisme "usul → admin approve per baris"** untuk relabel massal (versi
  desain awal yang lebih rumit sudah digantikan). Sebagai gantinya: checkpoint sampling
  sekali oleh admin di titik tertentu (lihat Fase C di bawah), lalu proses relabel massal
  jalan langsung menimpa data, dengan `labeling_log` menyimpan snapshot nilai lama
  otomatis sebagai jejak audit (bukan gerbang approval manual).

## 4. Skema database yang perlu dibuat

### 4.1 Kolom baru di tabel `news` (Supabase)

```sql
alter table news add column screener_passed boolean; -- NULL = belum discreening
alter table news add column screener_assigned_to uuid references profiles(id);
alter table news add column screener_assigned_at timestamptz;
alter table news add column lapus_assigned_to uuid references profiles(id);
alter table news add column lapus_assigned_at timestamptz;
alter table news add column pengeluaran_assigned_to uuid references profiles(id);
alter table news add column pengeluaran_assigned_at timestamptz;
```

Kolom `*_assigned_to`/`*_assigned_at` adalah soft-lock per jenis (perlu terpisah karena
Lapus & Pengeluaran bisa dikerjakan intern berbeda secara bersamaan di baris yang sama).
Lock dianggap kedaluwarsa kalau `*_assigned_at` lebih tua dari ~20-30 menit — baris balik
ke antrean otomatis.

### 4.2 Tabel baru `label_prompts`

```sql
create table label_prompts (
  id uuid primary key default gen_random_uuid(),
  jenis text not null check (jenis in ('screener','lapus','pengeluaran')),
  versi text not null,
  isi_prompt text not null,
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);
```

Halaman labeling fetch prompt yang `is_active = true` sesuai jenisnya. Merevisi prompt
= insert baris baru + set `is_active` lama jadi false, tidak perlu deploy ulang situs.

### 4.3 Tabel baru `labeling_log`

```sql
create table labeling_log (
  id uuid primary key default gen_random_uuid(),
  news_id bigint not null references news(id),
  jenis text not null check (jenis in ('screener','lapus','pengeluaran')),
  labeler_id uuid not null references profiles(id),
  hasil jsonb not null,           -- {relevan, kategori/komponen, alasan, arah} atau {lolos, alasan}
  previous_value jsonb,           -- snapshot kolom terkait di `news` sebelum submit ini (null kalau baris baru)
  prompt_version_id uuid references label_prompts(id),
  batch_tag text,                 -- mis. 'relabel_2026_10', null untuk backlog biasa
  created_at timestamptz not null default now()
);
```

Ini jadi **audit trail utama** dan **sumber data monitoring produktivitas intern**
(hitung `count(*) group by labeler_id, jenis, date`).

### 4.4 Query antrean (dipakai tiap halaman)

- Antrean Screener: `screener_passed IS NULL AND (screener_assigned_to IS NULL OR screener_assigned_at < now() - interval '25 min')`
- Antrean Lapus: `screener_passed = true AND lu_relevan IS NULL AND (lapus_assigned_to IS NULL OR lapus_assigned_at < now() - interval '25 min')`
- Antrean Pengeluaran: sama pola dengan Lapus, ganti kolom relevannya.

### 4.5 Mekanisme relabel massal (Fase D, lihat bagian 5)

Satu aksi admin (SQL/tombol sekali jalan), BUKAN halaman terpisah:
1. Insert snapshot nilai lama seluruh baris target ke `labeling_log`
   (`hasil` boleh kosong, `previous_value` diisi, `batch_tag = 'relabel_<tanggal>'`).
2. Reset `lu_relevan`, `pengeluaran_relevan`, `kategori_lapus`, `komponen_pengeluaran`,
   `screener_passed` (dan kolom assigned terkait) jadi `NULL` untuk baris-baris itu.
3. Baris otomatis muncul di antrean Screener yang sama seperti baris kosong biasa —
   tidak perlu mode/halaman baru untuk "relabel".

## 5. Alur kerja end-to-end (Fase A-E)

**Fase A — Persiapan (belum dikerjakan sama sekali secara teknis)**
1. Jalankan migrasi skema di atas (kolom baru + 2 tabel baru).
2. Insert 3 prompt final ke `label_prompts` (`is_active = true`).
3. Tambah kolom `is_labeler` ke `profiles`, set true untuk akun intern yang dipakai.
4. Bangun 3 halaman: `labeling-screener.html`, `labeling-lapus.html`,
   `labeling-pengeluaran.html` (pola desain sama, lihat bagian 6).
5. Bangun Edge Function `submit-label` (verifikasi JWT + `is_labeler`, tulis ke `news`
   + `labeling_log` dalam satu transaksi, lepas assignment lock).

**Fase B — Label backlog kosong (~6.742 baris)**
6. Staffing: SEMUA intern kerja di halaman Screener dulu sampai antrean habis (tugas
   ini cepat, prompt lebih pendek). Baru setelah itu, split ~separuh ke Lapus,
   separuh ke Pengeluaran.
7. Submit di fase ini langsung masuk ke `news` (baris kosong, tidak ada yang ditimpa).

**Fase C — Checkpoint validasi (gerbang wajib sebelum Fase D)**
8. Admin sampling manual sebagian hasil backlog (ratusan baris, bukan semua) — cek
   rate Ya/Tidak masuk akal, cek apakah pola overreach lama masih lolos prompt baru.
9. Kalau belum oke → revisi prompt, ulangi sebagian/seluruh backlog, cek lagi.
10. Kalau oke → lanjut Fase D.

**Fase D — Relabel SEMUA 22.810 baris lama**
11. Jalankan mekanisme reset di 4.5 untuk seluruh baris lama.
12. Proses sama seperti Fase B (semua kategori diperlakukan sama, TIDAK dipilah
    prioritas per kategori — keputusan eksplisit: cek ulang semua, bukan cuma
    kategori berisiko tinggi).
13. Karena sudah lolos checkpoint di Fase C, hasil baru **langsung menimpa** nilai lama
    di `news` tanpa approval manual per baris. `labeling_log.previous_value` sudah
    menyimpan jejak audit otomatis.
14. Untuk batch besar ini, staffing TIDAK perlu menunggu Screener 100% selesai dulu —
    begitu ada cukup banyak baris "Lolos" terkumpul, sebagian intern bisa mulai pindah
    ke Lapus/Pengeluaran sementara sisanya lanjut screening.

**Fase E — Lanjut roadmap**
15. Setelah backlog + relabel selesai, lanjut ke item roadmap `news-scraper-babel`
    CLAUDE.md: training Negative Screener (model ML sungguhan) dan L1/L2/P1/P2.

## 6. Desain halaman (pola sama untuk ketiga mode)

Tiap halaman (`Screener` / `Lapus` / `Pengeluaran`):
1. Counter "Sisa antrean: N baris".
2. Kartu artikel: judul, tanggal, sumber, isi lengkap.
3. Tombol **"Copy Prompt + Artikel"** — gabungkan prompt aktif dari `label_prompts`
   (sesuai jenis halaman) + teks artikel, siap tempel ke Copilot.
4. Textarea **"Tempel hasil AI di sini"**.
5. Tombol **"Validasi"** — parse format sesuai jenis:
   - Screener: `[No]|||[Lolos/Tidak Lolos]|||[Alasan]` (3 kolom).
   - Lapus/Pengeluaran: `[No]|||[Ya/Tidak]|||[Kategori/Komponen atau -]|||[Alasan]|||[Naik/Turun/Netral/-]` (5 kolom).
   - Validasi: separator tepat, enum valid (Ya/Tidak, Lolos/Tidak Lolos, kode
     kategori/komponen dikenal, arah valid), konsistensi (Tidak → "-").
   - Kalau invalid, tampilkan pesan error spesifik.
6. Kalau valid → tombol **"Kirim"** muncul → panggil Edge Function `submit-label`.
7. Setelah kirim sukses → baris berikutnya di antrean otomatis dimuat (tanpa klik
   "next" manual).
8. Tombol kecil **"Lewati"** untuk skip (melepas lock, baris balik ke antrean).

Halaman ini hanya bisa diakses akun dengan `is_labeler = true` (gate di level halaman,
sama pola dengan `requireAuth()` yang sudah ada di `auth.js`).

## 7. Monitoring produktivitas intern

Tidak perlu infrastruktur baru — `labeling_log` sudah mencatat `labeler_id` +
`created_at` di setiap submit. Cukup buat 1 halaman/laporan admin (bisa sesederhana
query yang ditampilkan dalam tabel) yang menghitung jumlah submit per intern, per
jenis, per hari/minggu.

## 8. Urutan pengerjaan teknis yang disarankan untuk sesi berikutnya

1. Migrasi skema Supabase (bagian 4.1-4.3).
2. Insert 3 prompt final ke `label_prompts`.
3. Edge Function `submit-label` (termasuk logika klaim/lock & lepas lock).
4. Halaman `labeling-screener.html` dulu (paling sederhana, dipakai duluan di Fase B).
5. Halaman `labeling-lapus.html` dan `labeling-pengeluaran.html` (reuse komponen dari
   langkah 4, cuma beda skema validasi).
6. Laporan monitoring sederhana untuk admin.
7. Baru setelah semua di atas jalan → mulai Fase B (label backlog) secara operasional.
