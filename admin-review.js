// Menu "Review Label" (admin) — Tahap C: SATU kartu per artikel menampilkan
// status Screener + Lapus + Pengeluaran sekaligus (bukan 3 antrean terpisah
// per-jenis seperti sebelumnya). Lapus/Pengeluaran berjalan paralel & async
// dari Screener (intern berbeda, waktu berbeda), jadi "digabung" di sini
// TIDAK berarti menunggu ketiganya lengkap sebelum bisa direview — kolom yang
// belum diproses cukup ditampilkan sebagai "Belum", tanpa memblokir kolom lain
// yang sudah actionable. Urutan tampil tetap stabil (newest-first), TIDAK
// diurutkan ulang berdasar kelengkapan — lihat migrasi
// admin_review_queue_by_article untuk alasan lengkapnya.
//
// Penyimpanan tetap lewat labelingSubmit() (labeling-common.js) -> Edge
// Function submit-label, supaya validasi & pembersihan status ditandai/perlu-
// relabel tidak perlu ditulis ulang di sini.

// Duplikat dari dashboard.js/news-search.js/labeling-lapus.js — repo ini
// sudah tidak punya modul bersama untuk daftar taksonomi, lihat CLAUDE.md.
const REVIEW_LAPUS_LABELS = {
  A: 'Pertanian, Kehutanan, dan Perikanan', B: 'Pertambangan dan Penggalian',
  C: 'Industri Pengolahan', D: 'Pengadaan Listrik dan Gas',
  E: 'Pengadaan Air, Pengelolaan Sampah, Limbah dan Daur Ulang', F: 'Konstruksi',
  G: 'Perdagangan Besar dan Eceran; Reparasi Mobil dan Sepeda Motor',
  H: 'Transportasi dan Pergudangan', I: 'Penyediaan Akomodasi dan Makan Minum',
  J: 'Informasi dan Komunikasi', K: 'Jasa Keuangan dan Asuransi', L: 'Real Estat',
  MN: 'Jasa Perusahaan', O: 'Administrasi Pemerintahan, Pertahanan dan Jaminan Sosial Wajib',
  P: 'Jasa Pendidikan', Q: 'Jasa Kesehatan dan Kegiatan Sosial', RSTU: 'Jasa Lainnya'
};
const REVIEW_PENGELUARAN_LABELS = {
  '1a': 'Makanan dan Minuman Non Alkohol', '1b': 'Minuman Beralkohol dan Rokok',
  '1c': 'Pakaian', '1d': 'Perumahan, Air, Listrik, Energi',
  '1e': 'Perabot dan Perlengkapan Rumah Tangga', '1f': 'Kesehatan', '1g': 'Transportasi',
  '1h': 'Komunikasi', '1i': 'Rekreasi dan Budaya', '1j': 'Pendidikan',
  '1k': 'Hotel dan Penginapan', '1l': 'Barang Pribadi dan Jasa Lainnya',
  '1': 'Pengeluaran Konsumsi Rumah Tangga', '2': 'Pengeluaran Konsumsi LNPRT',
  '3': 'Pengeluaran Konsumsi Pemerintah', '4': 'Pembentukan Modal Tetap Bruto',
  '5': 'Perubahan Inventori', '6': 'Ekspor Luar Negeri', '7': 'Impor Luar Negeri'
};

const REVIEW_JENIS_LABELS = { screener: 'Pengecekan Awal', lapus: 'Lapangan Usaha', pengeluaran: 'Pengeluaran' };
const REVIEW_JENIS_LIST = ['screener', 'lapus', 'pengeluaran'];

// Status per kolom yang dianggap "ada aksi yang bisa/perlu dilakukan admin" —
// dipakai untuk menentukan tombol Edit apa yang tampil. 'belum' (belum
// diproses / tidak berlaku) dan 'sudah_review' (sudah dikonfirmasi
// sebelumnya) sengaja tidak actionable.
const REVIEW_ACTIONABLE_STATUSES = ['ditandai', 'perlu_relabel', 'perlu_review'];

// Subset yang bisa disetujui langsung tanpa mengisi form (tombol "Sesuai" /
// "Setuju Semua" / bulk approve) — 'ditandai' sengaja TIDAK termasuk: baris
// yang ditandai tidak punya label untuk disetujui, harus diselesaikan lewat
// Edit. Kartu/baris yang masih punya kolom 'ditandai' tidak boleh dianggap
// selesai hanya karena kolom lainnya sudah disetujui.
const REVIEW_APPROVABLE_STATUSES = ['perlu_relabel', 'perlu_review'];

const REVIEW_STATUS_BADGE = {
  belum: { text: 'Belum', cls: 'badge-gray' },
  ditandai: { text: '🚩 Ditandai', cls: 'badge-red' },
  perlu_relabel: { text: '♻️ Perlu Direlabel', cls: 'badge-amber' },
  perlu_review: { text: '👀 Perlu Direview', cls: 'badge-blue' },
  sudah_review: { text: '✅ Sudah Direview', cls: 'badge-green' }
};

// Satu batch penuh dimuat sekaligus (bukan infinite-scroll) — lihat catatan di
// reviewLoadBatch() untuk alasannya: infinite-scroll bentrok dengan tombol bulk
// approve yang sengaja ditaruh di bawah kartu terakhir supaya harus dilewati
// dulu (dibaca sekilas) sebelum bisa diklik.
const REVIEW_BATCH_SIZE = 10;

const reviewState = {
  batch: 'batch1', // '' | 'batch1' | 'batch2' — batch permanen (news.batch), default Batch 1 (Baru)
  completeness: '', // '' | 'lengkap' | 'sebagian'
  kondisiLabel: 'lolos_tidak', // '' | 'lolos_tidak' | 'tidak_lolos'
  total: 0,
  rows: [],       // batch yang sedang tampil saja — {..row, resolved: bool}
  loading: false,
  activePrompts: {} // jenis -> {id, isi_prompt, versi}, fetched lazily
};

function reviewCodesFor(jenis) {
  return jenis === 'lapus'
    ? { codes: LAPUS_CODES, labels: REVIEW_LAPUS_LABELS, field: 'kategori', dbField: 'kategori_lapus' }
    : { codes: PENGELUARAN_CODES, labels: REVIEW_PENGELUARAN_LABELS, field: 'komponen', dbField: 'komponen_pengeluaran' };
}

async function reviewEnsureActivePrompt(jenis) {
  if (reviewState.activePrompts[jenis]) return reviewState.activePrompts[jenis];
  try {
    reviewState.activePrompts[jenis] = await labelingFetchActivePrompt(jenis);
  } catch (err) {
    console.error(err);
  }
  return reviewState.activePrompts[jenis];
}

function reviewUpdateRemainingText() {
  const el = document.getElementById('review-remaining');
  el.textContent = `Sisa total di antrean ini: ${reviewState.total.toLocaleString('id-ID')} artikel`;
}

function reviewFormatMeta(row) {
  const d = row.publication_datetime ? labelingFormatDate(row.publication_datetime) : '-';
  return [`📅 ${labelingEscapeHtml(d)}`, `📰 ${labelingEscapeHtml(row.source || '-')}`].join(' &middot; ');
}

// row[jenis] = {status, label_value, hasil, alasan, flag_reason, kategori_lapus?, komponen_pengeluaran?}
function reviewLabelSummary(jenis, col) {
  if (jenis === 'screener') {
    if (!col.hasil) return col.status === 'belum' ? '(belum diproses)' : '(belum ada label)';
    return col.hasil.lolos ? 'Lolos' : 'Tidak Lolos';
  }
  if (!col.label_value) return '(belum diproses)';
  const { labels, dbField } = reviewCodesFor(jenis);
  const codes = col[dbField];
  const arah = col.hasil?.arah;
  const parts = [col.label_value];
  if (Array.isArray(codes) && codes.length) {
    parts.push('(' + codes.map(c => labels[c] ? `${c} - ${labels[c]}` : c).join('; ') + ')');
  }
  if (arah) parts.push(`Arah: ${arah}`);
  return parts.join(' ');
}

function reviewBuildPerbaikiFormHtml(jenis, rowId, col) {
  const hasil = col.hasil || {};
  if (jenis === 'screener') {
    const lolosChecked = hasil.lolos === true ? 'checked' : '';
    const tidakChecked = hasil.lolos === false ? 'checked' : '';
    return `
      <div class="review-form-row">
        <label><input type="radio" name="lolos-${rowId}-${jenis}" value="ya" ${lolosChecked}> Lolos</label>
        <label><input type="radio" name="lolos-${rowId}-${jenis}" value="tidak" ${tidakChecked}> Tidak Lolos</label>
      </div>
      <textarea class="review-alasan-input labeling-textarea" placeholder="Alasan...">${labelingEscapeHtml(hasil.alasan || '')}</textarea>
    `;
  }

  const { codes, labels } = reviewCodesFor(jenis);
  const dbField = jenis === 'lapus' ? 'kategori_lapus' : 'komponen_pengeluaran';
  const currentCodes = col[dbField] || [];
  const relevanYa = hasil.relevan === 'Ya' ? 'checked' : '';
  const relevanTidak = hasil.relevan === 'Tidak' ? 'checked' : '';
  const arah = hasil.arah || '';
  const checkboxes = codes.map(c => `
    <label class="review-code-option">
      <input type="checkbox" class="review-code-checkbox" value="${labelingEscapeHtml(c)}" ${currentCodes.includes(c) ? 'checked' : ''}>
      ${labelingEscapeHtml(c)} - ${labelingEscapeHtml(labels[c] || c)}
    </label>`).join('');

  return `
    <div class="review-form-row">
      <label><input type="radio" name="relevan-${rowId}-${jenis}" value="Ya" ${relevanYa}> Ya, relevan</label>
      <label><input type="radio" name="relevan-${rowId}-${jenis}" value="Tidak" ${relevanTidak}> Tidak relevan</label>
    </div>
    <div class="review-codes-box">${checkboxes}</div>
    <div class="review-form-row">
      <label>Arah:
        <select class="review-arah-select">
          <option value="">-</option>
          <option value="Naik" ${arah === 'Naik' ? 'selected' : ''}>Naik</option>
          <option value="Turun" ${arah === 'Turun' ? 'selected' : ''}>Turun</option>
          <option value="Netral" ${arah === 'Netral' ? 'selected' : ''}>Netral</option>
        </select>
      </label>
    </div>
    <textarea class="review-alasan-input labeling-textarea" placeholder="Alasan...">${labelingEscapeHtml(hasil.alasan || '')}</textarea>
  `;
}

// Builds the `hasil` object from a column's currently-open Perbaiki form.
// Returns {hasil} on success or throws Error(message) — same contract as
// parseScreenerLine()/parseLapusLine()/parsePengeluaranLine() so validation
// stays consistent with what the labeling pages already enforce.
function reviewReadPerbaikiForm(jenis, colEl, rowId) {
  const alasan = colEl.querySelector('.review-alasan-input').value.trim();
  if (!alasan) throw new Error('Alasan tidak boleh kosong.');

  if (jenis === 'screener') {
    const checked = colEl.querySelector(`input[name="lolos-${rowId}-${jenis}"]:checked`);
    if (!checked) throw new Error('Pilih Lolos atau Tidak Lolos.');
    return { hasil: { lolos: checked.value === 'ya', alasan } };
  }

  const field = jenis === 'lapus' ? 'kategori' : 'komponen';
  const checkedRelevan = colEl.querySelector(`input[name="relevan-${rowId}-${jenis}"]:checked`);
  if (!checkedRelevan) throw new Error('Pilih Ya atau Tidak relevan.');
  const relevan = checkedRelevan.value;

  if (relevan === 'Tidak') {
    return { hasil: { relevan: 'Tidak', [field]: [], alasan, arah: null } };
  }

  const codes = Array.from(colEl.querySelectorAll('.review-code-checkbox:checked')).map(c => c.value);
  if (codes.length < 1 || codes.length > 2) {
    throw new Error(`Pilih 1-2 kode ${field} ketika relevan = Ya.`);
  }
  const arah = colEl.querySelector('.review-arah-select').value;
  if (!arah) throw new Error('Pilih arah (Naik/Turun/Netral) ketika relevan = Ya.');

  return { hasil: { relevan: 'Ya', [field]: codes, alasan, arah } };
}

function reviewRenderColumn(jenis, rowId, col) {
  const badge = REVIEW_STATUS_BADGE[col.status] || REVIEW_STATUS_BADGE.belum;
  const actionable = REVIEW_ACTIONABLE_STATUSES.includes(col.status);
  const showSesuai = col.status === 'perlu_relabel' || col.status === 'perlu_review';
  const flagLine = col.status === 'ditandai' && col.flag_reason
    ? `<div class="review-flag-reason">🚩 Alasan ditandai: ${labelingEscapeHtml(col.flag_reason)}</div>` : '';

  return `
    <div class="review-column" data-jenis="${jenis}">
      <div class="review-column-head">
        <span class="review-column-title">${REVIEW_JENIS_LABELS[jenis]}</span>
        <span class="badge ${badge.cls}">${badge.text}</span>
      </div>
      <div class="review-column-summary">
        <div class="review-label-current">🏷️ ${labelingEscapeHtml(reviewLabelSummary(jenis, col))}</div>
        ${actionable ? `
          <div class="review-icon-actions">
            ${showSesuai ? '<button class="review-icon-btn" data-action="sesuai" title="Sesuai" aria-label="Sesuai">✅</button>' : ''}
            <button class="review-icon-btn" data-action="edit-toggle" title="Edit" aria-label="Edit">✏️</button>
            <button class="review-icon-btn" data-action="ai-toggle" title="Bantuan AI" aria-label="Bantuan AI">🤖</button>
          </div>` : ''}
      </div>
      ${col.alasan ? `<details class="review-alasan-current"><summary>💬 ${labelingEscapeHtml(col.alasan)}</summary></details>` : ''}
      ${flagLine}
      ${actionable ? `
        <div class="review-ai-box" hidden>
          <button class="card-btn" data-action="ai-copy">📋 Salin Prompt + Artikel</button>
          <textarea class="review-ai-textarea labeling-textarea" placeholder="Tempel jawaban AI di sini..."></textarea>
          <button class="card-btn" data-action="ai-fill">Isi Otomatis ke Form Edit</button>
        </div>
        <div class="review-perbaiki-box" hidden>
          ${reviewBuildPerbaikiFormHtml(jenis, rowId, col)}
          <div class="review-form-msg labeling-validation-msg"></div>
          <div class="labeling-actions">
            <button class="primary-btn" data-action="perbaiki-submit">Simpan</button>
            <button class="secondary-btn" data-action="perbaiki-cancel">Batal</button>
          </div>
        </div>
      ` : ''}
    </div>
  `;
}

function reviewRenderCard(row) {
  const card = document.createElement('div');
  card.className = 'labeling-card review-card review-card-article';
  card.dataset.id = row.id;

  const columnsHtml = REVIEW_JENIS_LIST.map(jenis => reviewRenderColumn(jenis, row.id, row[jenis])).join('');
  // "Setuju Semua" hanya tampil kalau ada minimal 1 kolom yang benar-benar
  // bisa disetujui langsung (perlu_relabel/perlu_review) — kolom 'ditandai'
  // saja tidak cukup, karena flag tidak bisa diselesaikan lewat tombol ini
  // (harus lewat Edit).
  const anyApprovable = REVIEW_JENIS_LIST.some(j => REVIEW_APPROVABLE_STATUSES.includes(row[j].status));

  card.innerHTML = `
    <h3>${labelingEscapeHtml(row.title || '(tanpa judul)')}</h3>
    <div class="labeling-meta">${reviewFormatMeta(row)}</div>
    <div class="review-article-links">
      ${row.summary ? `<details class="review-summary-toggle"><summary>Ringkasan</summary><div class="review-summary">${labelingEscapeHtml(row.summary)}</div></details>` : ''}
      ${row.content ? `<details class="review-full-content"><summary>Lihat isi lengkap</summary><div>${labelingEscapeHtml(row.content)}</div></details>` : ''}
      ${row.url ? `<a href="${labelingEscapeHtml(row.url)}" target="_blank" rel="noopener" class="review-source-link">🔗 Buka artikel asli</a>` : ''}
    </div>

    <div class="review-columns">${columnsHtml}</div>

    <div class="labeling-actions review-card-actions">
      ${anyApprovable ? '<button class="primary-btn" data-action="setuju-semua">✅ Setuju Semua</button>' : ''}
      <button class="secondary-btn" data-action="lewati">⏭️ Lewati Artikel Ini</button>
    </div>
  `;
  return card;
}

// Cuma bersih-bersih DOM/state satu kartu -- tidak mengecek atau memuat batch
// berikutnya sendiri (lihat reviewMaybeAdvance()), supaya dipanggil berkali-kali
// dari dalam loop bulk-approve tidak memicu banyak pemuatan batch sekaligus.
function reviewRemoveCard(rowId) {
  const row = reviewState.rows.find(r => r.id === rowId);
  if (row) row.resolved = true;
  const el = document.querySelector(`.review-card[data-id="${rowId}"]`);
  if (el) el.remove();
  reviewUpdateRemainingText();
}

// Batch ini otomatis dianggap selesai begitu tidak ada kartu tersisa yang
// belum ditangani (baik lewat aksi individual satu-satu, maupun lewat tombol
// bulk) -- langsung muat batch berikutnya tanpa perlu tombol "Next" terpisah.
function reviewMaybeAdvance() {
  const stillPending = reviewState.rows.some(r => !r.resolved);
  if (!stillPending) reviewLoadBatch();
}

function reviewRenderBatchBar() {
  const bar = document.createElement('div');
  bar.className = 'review-batch-bar';
  const canBulk = reviewState.rows.some(r => REVIEW_JENIS_LIST.some(j => REVIEW_APPROVABLE_STATUSES.includes(r[j].status)));
  bar.innerHTML = `
    <div class="review-batch-bar-text">Batch ini: ${reviewState.rows.length.toLocaleString('id-ID')} artikel</div>
    ${canBulk ? '<button id="review-bulk-approve" class="primary-btn">✅ Semua di batch ini sesuai</button>' : ''}
  `;
  return bar;
}

// Satu batch penuh dimuat sekaligus, BUKAN infinite-scroll: request selalu
// p_page=1 karena baris yang sudah ditangani (dilabel ulang / ditandai
// direview di ketiga kolomnya) otomatis tidak lagi memenuhi kondisi query-nya
// sendiri (lihat admin_review_queue_by_article()), jadi "halaman 1" selalu
// berarti "artikel berikutnya yang masih punya kolom actionable" -- tidak
// perlu nomor halaman bertambah.
async function reviewLoadBatch() {
  if (reviewState.loading) return;
  reviewState.loading = true;
  const list = document.getElementById('review-list');
  const loadingEl = document.getElementById('review-loading');
  const emptyEl = document.getElementById('review-empty');
  loadingEl.hidden = false;
  list.innerHTML = '';
  emptyEl.hidden = true;
  try {
    const { data, error } = await window.db.rpc('admin_review_queue_by_article', {
      p_page: 1,
      p_page_size: REVIEW_BATCH_SIZE,
      p_completeness: reviewState.completeness || null,
      p_batch: reviewState.batch || null,
      p_kondisi_label: reviewState.kondisiLabel || null
    });
    if (error) throw error;
    reviewState.total = data.total || 0;
    const rows = data.rows || [];

    reviewState.rows = rows.map(row => ({ ...row, resolved: false }));
    rows.forEach(row => list.appendChild(reviewRenderCard(row)));
    if (rows.length) {
      list.appendChild(reviewRenderBatchBar());
      const bulkBtn = document.getElementById('review-bulk-approve');
      if (bulkBtn) bulkBtn.addEventListener('click', reviewHandleBulkApprove);
    } else {
      emptyEl.hidden = false;
    }
    reviewUpdateRemainingText();
  } catch (err) {
    alert('Gagal memuat antrean: ' + err.message);
    console.error(err);
  } finally {
    reviewState.loading = false;
    loadingEl.hidden = true;
  }
}

// Dipanggil saat ganti filter kelengkapan -- reviewLoadBatch() sendiri sudah
// membersihkan #review-list/#review-empty di awal, jadi cukup panggil itu.
function reviewResetAndLoad() {
  reviewState.total = 0;
  reviewState.rows = [];
  reviewLoadBatch();
}

async function reviewMarkReviewed(jenis, newsIds) {
  const { error } = await window.db.rpc('admin_qc_mark_reviewed', { p_news_ids: newsIds, p_jenis: jenis });
  if (error) throw new Error('Gagal menandai sudah direview: ' + error.message);
}

// Menyetujui SATU kolom (jenis) pada satu artikel: 'perlu_relabel' -> submit
// ulang nilai yang sama (mencatat log baru dengan prompt_version_id aktif,
// otomatis membersihkan status "perlu direlabel"); 'perlu_review' -> cukup
// dicatat sudah direview, tidak ada yang berubah pada labelnya.
async function reviewApproveColumn(rowId, jenis, col) {
  if (col.status === 'perlu_relabel') {
    await labelingSubmit(rowId, jenis, col.hasil, 'review');
  }
  if (col.status === 'perlu_relabel' || col.status === 'perlu_review') {
    await reviewMarkReviewed(jenis, [rowId]);
  }
}

function reviewSetCardButtonsDisabled(card, disabled) {
  card.querySelectorAll('button').forEach(b => b.disabled = disabled);
}

// Hanya menyetujui kolom yang berstatus perlu_relabel/perlu_review (lihat
// REVIEW_APPROVABLE_STATUSES) -- kolom 'ditandai' dilewati begitu saja, TIDAK
// ikut disetujui. Kartu baru dianggap selesai (reviewRemoveCard) kalau tidak
// ada satu pun kolom actionable (termasuk 'ditandai') yang tersisa setelah
// ini -- lewat reviewRerenderCard(), supaya kartu dengan flag yang belum
// diselesaikan tetap tampil, bukan diam-diam disembunyikan.
async function reviewHandleSetujuSemua(rowId, card) {
  const row = reviewState.rows.find(r => r.id === rowId);
  if (!row) return;
  reviewSetCardButtonsDisabled(card, true);
  const failures = [];
  for (const jenis of REVIEW_JENIS_LIST) {
    const col = row[jenis];
    if (!REVIEW_APPROVABLE_STATUSES.includes(col.status)) continue;
    try {
      await reviewApproveColumn(rowId, jenis, col);
      col.status = 'sudah_review';
    } catch (err) {
      failures.push(`${REVIEW_JENIS_LABELS[jenis]}: ${err.message}`);
    }
  }
  if (failures.length) {
    alert('Sebagian gagal disimpan:\n' + failures.join('\n'));
  }
  reviewRerenderCard(row);
}

async function reviewHandleColumnSesuai(rowId, jenis, colEl, card) {
  const row = reviewState.rows.find(r => r.id === rowId);
  if (!row) return;
  reviewSetCardButtonsDisabled(card, true);
  try {
    await reviewApproveColumn(rowId, jenis, row[jenis]);
    row[jenis].status = 'sudah_review';
    reviewRerenderCard(row);
  } catch (err) {
    alert('Gagal menyimpan: ' + err.message);
    reviewSetCardButtonsDisabled(card, false);
  }
}

function reviewHandleLewati(rowId) {
  // Tidak menulis apa pun -- artikel ini tetap di status semula. Karena
  // batch berikutnya juga selalu meminta "halaman 1" dari kondisi yang sama,
  // artikel yang dilewati bisa saja muncul lagi di batch berikutnya dalam
  // sesi yang sama (bukan cuma "nanti"), bukan cuma di sesi yang benar-benar
  // baru.
  reviewRemoveCard(rowId);
  reviewMaybeAdvance();
}

// Re-render satu kartu di tempat (dipakai setelah satu kolom berubah status
// tapi kartu secara keseluruhan belum selesai) tanpa memuat ulang batch.
function reviewRerenderCard(row) {
  const oldEl = document.querySelector(`.review-card[data-id="${row.id}"]`);
  if (!oldEl) return;
  const newEl = reviewRenderCard(row);
  oldEl.replaceWith(newEl);
  const stillActionable = REVIEW_JENIS_LIST.some(j => REVIEW_ACTIONABLE_STATUSES.includes(row[j].status));
  if (!stillActionable) {
    reviewRemoveCard(row.id);
    reviewMaybeAdvance();
  }
}

async function reviewHandlePerbaikiSubmit(rowId, jenis, colEl, card) {
  const row = reviewState.rows.find(r => r.id === rowId);
  if (!row) return;
  const msgEl = colEl.querySelector('.review-form-msg');
  msgEl.textContent = '';
  msgEl.className = 'review-form-msg labeling-validation-msg';
  let hasil;
  try {
    ({ hasil } = reviewReadPerbaikiForm(jenis, colEl, rowId));
  } catch (err) {
    msgEl.textContent = '❌ ' + err.message;
    msgEl.classList.add('error');
    return;
  }
  reviewSetCardButtonsDisabled(card, true);
  msgEl.textContent = 'Menyimpan...';
  try {
    await labelingSubmit(rowId, jenis, hasil, 'review');
    await reviewMarkReviewed(jenis, [rowId]);
    row[jenis].status = 'sudah_review';
    reviewRerenderCard(row);
  } catch (err) {
    msgEl.textContent = '❌ Gagal menyimpan: ' + err.message;
    msgEl.classList.add('error');
    reviewSetCardButtonsDisabled(card, false);
  }
}

async function reviewHandleAiCopy(row, jenis, btn) {
  const prompt = await reviewEnsureActivePrompt(jenis);
  if (!prompt) { alert('Prompt aktif untuk jenis ini belum ada.'); return; }
  const text = prompt.isi_prompt + '\n' + labelingFormatArticleForPrompt(row);
  const ok = await labelingCopyToClipboard(text);
  const original = btn.textContent;
  btn.textContent = ok ? '✅ Disalin!' : '❌ Gagal menyalin';
  setTimeout(() => { btn.textContent = original; }, 1800);
}

function reviewHandleAiFill(rowId, jenis, colEl) {
  const raw = colEl.querySelector('.review-ai-textarea').value;
  const msgEl = colEl.querySelector('.review-form-msg');
  let parsed;
  try {
    if (jenis === 'screener') parsed = parseScreenerLine(raw, rowId);
    else if (jenis === 'lapus') parsed = parseLapusLine(raw, rowId);
    else parsed = parsePengeluaranLine(raw, rowId);
  } catch (err) {
    alert('❌ ' + err.message);
    return;
  }
  const { hasil } = parsed;
  colEl.querySelector('.review-perbaiki-box').hidden = false;
  if (jenis === 'screener') {
    const val = hasil.lolos ? 'ya' : 'tidak';
    const radio = colEl.querySelector(`input[name="lolos-${rowId}-${jenis}"][value="${val}"]`);
    if (radio) radio.checked = true;
  } else {
    const radio = colEl.querySelector(`input[name="relevan-${rowId}-${jenis}"][value="${hasil.relevan}"]`);
    if (radio) radio.checked = true;
    const codes = hasil.kategori || hasil.komponen || [];
    colEl.querySelectorAll('.review-code-checkbox').forEach(cb => { cb.checked = codes.includes(cb.value); });
    const arahSel = colEl.querySelector('.review-arah-select');
    if (arahSel) arahSel.value = hasil.arah || '';
  }
  colEl.querySelector('.review-alasan-input').value = hasil.alasan || '';
  if (msgEl) { msgEl.textContent = ''; msgEl.className = 'review-form-msg labeling-validation-msg'; }
}

// Menyetujui kolom perlu_relabel/perlu_review dari SEMUA kartu yang masih
// pending di batch ini, satu artikel demi satu artikel (tiap kolom
// 'perlu_relabel' tetap harus disubmit ulang satu-satu ke submit_label()
// supaya prompt_version_id-nya ikut ter-update -- tidak ada versi bulk-nya).
// Kolom 'ditandai' TIDAK ikut disetujui (lihat REVIEW_APPROVABLE_STATUSES) --
// artikel yang masih punya kolom ditandai setelah ini di-rerender di tempat
// (tetap tampil, bukan dihapus), sama seperti reviewHandleSetujuSemua().
// Artikel yang gagal sebagian juga tetap tampil supaya bisa dicoba lagi,
// bukan diam-diam terlewat.
async function reviewHandleBulkApprove() {
  const pending = reviewState.rows.filter(r => !r.resolved);
  if (!pending.length) return;
  const ok = confirm(`Setujui semua kolom yang bisa disetujui di ${pending.length} artikel pada batch ini?`);
  if (!ok) return;
  const btn = document.getElementById('review-bulk-approve');
  btn.disabled = true;
  const failedRows = [];
  btn.textContent = `Memproses 0/${pending.length}...`;
  for (let i = 0; i < pending.length; i++) {
    const row = pending[i];
    for (const jenis of REVIEW_JENIS_LIST) {
      const col = row[jenis];
      if (!REVIEW_APPROVABLE_STATUSES.includes(col.status)) continue;
      try {
        await reviewApproveColumn(row.id, jenis, col);
        col.status = 'sudah_review';
      } catch (err) {
        failedRows.push({ row, jenis, err });
      }
    }
    reviewRerenderCard(row);
    btn.textContent = `Memproses ${i + 1}/${pending.length}...`;
  }
  if (failedRows.length) {
    alert(`${failedRows.length} kolom gagal disimpan (dibiarkan tetap tampil untuk dicoba lagi):\n` +
      failedRows.map(f => `- ID ${f.row.id} (${REVIEW_JENIS_LABELS[f.jenis]}): ${f.err.message}`).join('\n'));
  }
  reviewMaybeAdvance();
  if (document.body.contains(btn)) {
    btn.disabled = false;
    btn.textContent = '✅ Semua di batch ini sesuai';
  }
}

function reviewWireListDelegation() {
  document.getElementById('review-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const card = e.target.closest('.review-card');
    const rowId = parseInt(card.dataset.id, 10);
    const row = reviewState.rows.find(r => r.id === rowId);
    const action = btn.dataset.action;

    if (action === 'setuju-semua') return reviewHandleSetujuSemua(rowId, card);
    if (action === 'lewati') return reviewHandleLewati(rowId);

    const colEl = e.target.closest('.review-column');
    const jenis = colEl ? colEl.dataset.jenis : null;

    if (action === 'sesuai') return reviewHandleColumnSesuai(rowId, jenis, colEl, card);
    if (action === 'edit-toggle') {
      colEl.querySelector('.review-perbaiki-box').hidden = false;
      colEl.querySelector('.review-ai-box').hidden = true;
      return;
    }
    if (action === 'perbaiki-cancel') {
      colEl.querySelector('.review-perbaiki-box').hidden = true;
      return;
    }
    if (action === 'perbaiki-submit') return reviewHandlePerbaikiSubmit(rowId, jenis, colEl, card);
    if (action === 'ai-toggle') {
      const box = colEl.querySelector('.review-ai-box');
      box.hidden = !box.hidden;
      return;
    }
    if (action === 'ai-copy') return reviewHandleAiCopy(row, jenis, btn);
    if (action === 'ai-fill') return reviewHandleAiFill(rowId, jenis, colEl);
  });
}

function initReviewPage() {
  [['review-batch', 'batch'], ['review-completeness', 'completeness']].forEach(([id, key]) => {
    document.getElementById(id).addEventListener('change', e => {
      reviewState[key] = e.target.value;
      reviewResetAndLoad();
    });
  });

  document.getElementById('review-kondisi-label').addEventListener('change', e => {
    reviewState.kondisiLabel = e.target.value;
    reviewResetAndLoad();
  });

  reviewWireListDelegation();

  REVIEW_JENIS_LIST.forEach(reviewEnsureActivePrompt);
  reviewResetAndLoad();
}
