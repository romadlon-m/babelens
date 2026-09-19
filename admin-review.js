// Menu "Review Label" (admin) — kartu per-baris untuk 3 antrean yang butuh
// perhatian admin (Ditandai bermasalah / Perlu direlabel / Sudah dilabel,
// scope QC menyeluruh). Lihat CLAUDE.md "Menu Review Label (admin)" untuk
// desain lengkap dan alasannya.
//
// Sengaja bukan halaman terpisah per aksi seperti labeling-*.html — di sini
// admin memilih label yang benar langsung lewat kontrol di kartu (bukan
// copy-paste-ke-AI-eksternal-lalu-tempel-balik), walau tombol "Bantuan AI"
// opsional tetap tersedia untuk kasus yang ragu. Penyimpanan tetap lewat
// labelingSubmit() (labeling-common.js) -> Edge Function submit-label, supaya
// validasi & pembersihan status ditandai/perlu-relabel tidak perlu ditulis
// ulang di sini.

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

// Satu batch penuh dimuat sekaligus (bukan infinite-scroll) — lihat catatan di
// reviewLoadBatch() untuk alasannya: infinite-scroll bentrok dengan tombol bulk
// approve yang sengaja ditaruh di bawah kartu terakhir supaya harus dilewati
// dulu (dibaca sekilas) sebelum bisa diklik.
const REVIEW_BATCH_SIZE = 10;

const reviewState = {
  jenis: 'screener',
  scope: 'ditandai',
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
  el.textContent = `Sisa total di antrean ini: ${reviewState.total.toLocaleString('id-ID')} baris`;
}

function reviewFormatMeta(row) {
  const d = row.publication_datetime ? labelingFormatDate(row.publication_datetime) : '-';
  return [`📅 ${labelingEscapeHtml(d)}`, `📰 ${labelingEscapeHtml(row.source || '-')}`].join(' &middot; ');
}

function reviewLabelSummary(jenis, row) {
  if (jenis === 'screener') {
    const hasil = row.hasil;
    if (!hasil) return '(belum ada label)';
    return hasil.lolos ? 'Lolos' : 'Tidak Lolos';
  }
  if (!row.label_value) return '(belum ada label)';
  const { labels, dbField } = reviewCodesFor(jenis);
  const codes = row[dbField];
  const arah = row.hasil?.arah;
  const parts = [row.label_value];
  if (Array.isArray(codes) && codes.length) {
    parts.push('(' + codes.map(c => labels[c] ? `${c} - ${labels[c]}` : c).join('; ') + ')');
  }
  if (arah) parts.push(`Arah: ${arah}`);
  return parts.join(' ');
}

function reviewBuildPerbaikiFormHtml(jenis, row) {
  const hasil = row.hasil || {};
  if (jenis === 'screener') {
    const lolosChecked = hasil.lolos === true ? 'checked' : '';
    const tidakChecked = hasil.lolos === false ? 'checked' : '';
    return `
      <div class="review-form-row">
        <label><input type="radio" name="lolos-${row.id}" value="ya" ${lolosChecked}> Lolos</label>
        <label><input type="radio" name="lolos-${row.id}" value="tidak" ${tidakChecked}> Tidak Lolos</label>
      </div>
      <textarea class="review-alasan-input labeling-textarea" placeholder="Alasan...">${labelingEscapeHtml(hasil.alasan || '')}</textarea>
    `;
  }

  const { codes, labels } = reviewCodesFor(jenis);
  const currentCodes = jenis === 'lapus' ? (row.kategori_lapus || []) : (row.komponen_pengeluaran || []);
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
      <label><input type="radio" name="relevan-${row.id}" value="Ya" ${relevanYa}> Ya, relevan</label>
      <label><input type="radio" name="relevan-${row.id}" value="Tidak" ${relevanTidak}> Tidak relevan</label>
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

// Builds the `hasil` object from a card's currently-open Perbaiki form. Returns
// {hasil} on success or throws Error(message) — same contract as
// parseScreenerLine()/parseLapusLine()/parsePengeluaranLine() so validation
// stays consistent with what the labeling pages already enforce.
function reviewReadPerbaikiForm(jenis, cardEl, rowId) {
  const alasan = cardEl.querySelector('.review-alasan-input').value.trim();
  if (!alasan) throw new Error('Alasan tidak boleh kosong.');

  if (jenis === 'screener') {
    const checked = cardEl.querySelector(`input[name="lolos-${rowId}"]:checked`);
    if (!checked) throw new Error('Pilih Lolos atau Tidak Lolos.');
    return { hasil: { lolos: checked.value === 'ya', alasan } };
  }

  const field = jenis === 'lapus' ? 'kategori' : 'komponen';
  const checkedRelevan = cardEl.querySelector(`input[name="relevan-${rowId}"]:checked`);
  if (!checkedRelevan) throw new Error('Pilih Ya atau Tidak relevan.');
  const relevan = checkedRelevan.value;

  if (relevan === 'Tidak') {
    return { hasil: { relevan: 'Tidak', [field]: [], alasan, arah: null } };
  }

  const codes = Array.from(cardEl.querySelectorAll('.review-code-checkbox:checked')).map(c => c.value);
  if (codes.length < 1 || codes.length > 2) {
    throw new Error(`Pilih 1-2 kode ${field} ketika relevan = Ya.`);
  }
  const arah = cardEl.querySelector('.review-arah-select').value;
  if (!arah) throw new Error('Pilih arah (Naik/Turun/Netral) ketika relevan = Ya.');

  return { hasil: { relevan: 'Ya', [field]: codes, alasan, arah } };
}

function reviewRenderCard(row) {
  const card = document.createElement('div');
  card.className = 'labeling-card review-card';
  card.dataset.id = row.id;

  const showSesuai = reviewState.scope !== 'ditandai';
  const flagLine = reviewState.scope === 'ditandai' && row.flag_reason
    ? `<div class="review-flag-reason">🚩 Alasan ditandai: ${labelingEscapeHtml(row.flag_reason)}</div>` : '';

  card.innerHTML = `
    <h3>${labelingEscapeHtml(row.title || '(tanpa judul)')}</h3>
    <div class="labeling-meta">${reviewFormatMeta(row)}</div>
    <div class="review-label-current">🏷️ Label saat ini: ${labelingEscapeHtml(reviewLabelSummary(reviewState.jenis, row))}</div>
    ${row.alasan ? `<div class="review-alasan-current">💬 ${labelingEscapeHtml(row.alasan)}</div>` : ''}
    ${flagLine}
    <div class="review-summary">${labelingEscapeHtml(row.summary || '')}</div>
    ${row.content ? `<details class="review-full-content"><summary>Lihat isi lengkap</summary><div>${labelingEscapeHtml(row.content)}</div></details>` : ''}
    ${row.url ? `<a href="${labelingEscapeHtml(row.url)}" target="_blank" rel="noopener" class="review-source-link">🔗 Buka artikel asli</a>` : ''}

    <div class="labeling-actions">
      ${showSesuai ? '<button class="secondary-btn" data-action="sesuai">✅ Sesuai</button>' : ''}
      <button class="secondary-btn" data-action="perbaiki-toggle">✏️ Perbaiki</button>
      <button class="secondary-btn" data-action="lewati">⏭️ Lewati</button>
      <button class="secondary-btn" data-action="ai-toggle">🤖 Bantuan AI</button>
    </div>

    <div class="review-ai-box" hidden>
      <button class="card-btn" data-action="ai-copy">📋 Salin Prompt + Artikel</button>
      <textarea class="review-ai-textarea labeling-textarea" placeholder="Tempel jawaban AI di sini..."></textarea>
      <button class="card-btn" data-action="ai-fill">Isi Otomatis ke Form Perbaiki</button>
    </div>

    <div class="review-perbaiki-box" hidden>
      ${reviewBuildPerbaikiFormHtml(reviewState.jenis, row)}
      <div class="review-form-msg labeling-validation-msg"></div>
      <div class="labeling-actions">
        <button class="primary-btn" data-action="perbaiki-submit">Simpan</button>
        <button class="secondary-btn" data-action="perbaiki-cancel">Batal</button>
      </div>
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
// Kalau masih ada yang belum ditangani (mis. sebagian gagal saat bulk-approve),
// batch TIDAK otomatis lanjut, supaya tidak ada baris yang diam-diam terlewat.
function reviewMaybeAdvance() {
  const stillPending = reviewState.rows.some(r => !r.resolved);
  if (!stillPending) reviewLoadBatch();
}

function reviewRenderBatchBar() {
  const bar = document.createElement('div');
  bar.className = 'review-batch-bar';
  const canBulk = reviewState.scope !== 'ditandai' && reviewState.rows.length > 0;
  bar.innerHTML = `
    <div class="review-batch-bar-text">Batch ini: ${reviewState.rows.length.toLocaleString('id-ID')} baris</div>
    ${canBulk ? '<button id="review-bulk-approve" class="primary-btn">✅ Semua di batch ini sesuai</button>' : ''}
  `;
  return bar;
}

// Satu batch penuh dimuat sekaligus, BUKAN infinite-scroll: request selalu
// p_page=1 karena baris yang sudah ditangani (dilabel ulang / ditandai
// direview) otomatis tidak lagi memenuhi kondisi query-nya sendiri (lihat
// admin_review_queue()), jadi "halaman 1" selalu berarti "baris berikutnya
// yang belum ditangani" -- tidak perlu nomor halaman bertambah. Ini juga yang
// membuat tombol bulk-approve bisa ditaruh di BAWAH kartu terakhir (baru
// muncul setelah admin melewati semua kartu di batch itu) alih-alih di atas
// tempat ia bisa diklik tanpa membaca satu pun kartu.
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
    const { data, error } = await window.db.rpc('admin_review_queue', {
      p_jenis: reviewState.jenis,
      p_scope: reviewState.scope,
      p_page: 1,
      p_page_size: REVIEW_BATCH_SIZE
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

// Dipanggil saat ganti Jenis/Scope -- reviewLoadBatch() sendiri sudah
// membersihkan #review-list/#review-empty di awal, jadi cukup panggil itu.
function reviewResetAndLoad() {
  reviewState.total = 0;
  reviewState.rows = [];
  reviewLoadBatch();
}

async function reviewMarkReviewed(newsIds) {
  const { error } = await window.db.rpc('admin_qc_mark_reviewed', { p_news_ids: newsIds, p_jenis: reviewState.jenis });
  if (error) throw new Error('Gagal menandai sudah direview: ' + error.message);
}

async function reviewHandleSesuai(rowId, card) {
  const row = reviewState.rows.find(r => r.id === rowId);
  if (!row) return;
  card.querySelectorAll('button').forEach(b => b.disabled = true);
  try {
    if (reviewState.scope === 'perlu_relabel') {
      // Konfirmasi ulang nilai yang sama -> mencatat log baru dengan
      // prompt_version_id aktif, otomatis membersihkan status "perlu direlabel".
      await labelingSubmit(rowId, reviewState.jenis, row.hasil);
    }
    await reviewMarkReviewed([rowId]);
    reviewRemoveCard(rowId);
    reviewMaybeAdvance();
  } catch (err) {
    alert('Gagal menyimpan: ' + err.message);
    card.querySelectorAll('button').forEach(b => b.disabled = false);
  }
}

function reviewHandleLewati(rowId) {
  // Tidak menulis apa pun -- baris ini tetap di status semula. Karena batch
  // berikutnya juga selalu meminta "halaman 1" dari kondisi yang sama, baris
  // yang dilewati bisa saja muncul lagi di batch berikutnya dalam sesi yang
  // sama (bukan cuma "nanti"), bukan cuma di sesi yang benar-benar baru.
  reviewRemoveCard(rowId);
  reviewMaybeAdvance();
}

async function reviewHandlePerbaikiSubmit(rowId, card) {
  const msgEl = card.querySelector('.review-form-msg');
  msgEl.textContent = '';
  msgEl.className = 'review-form-msg labeling-validation-msg';
  let hasil;
  try {
    ({ hasil } = reviewReadPerbaikiForm(reviewState.jenis, card, rowId));
  } catch (err) {
    msgEl.textContent = '❌ ' + err.message;
    msgEl.classList.add('error');
    return;
  }
  card.querySelectorAll('button').forEach(b => b.disabled = true);
  msgEl.textContent = 'Menyimpan...';
  try {
    await labelingSubmit(rowId, reviewState.jenis, hasil);
    await reviewMarkReviewed([rowId]);
    reviewRemoveCard(rowId);
    reviewMaybeAdvance();
  } catch (err) {
    msgEl.textContent = '❌ Gagal menyimpan: ' + err.message;
    msgEl.classList.add('error');
    card.querySelectorAll('button').forEach(b => b.disabled = false);
  }
}

async function reviewHandleAiCopy(row, btn) {
  const prompt = await reviewEnsureActivePrompt(reviewState.jenis);
  if (!prompt) { alert('Prompt aktif untuk jenis ini belum ada.'); return; }
  const text = prompt.isi_prompt + '\n' + labelingFormatArticleForPrompt(row);
  const ok = await labelingCopyToClipboard(text);
  const original = btn.textContent;
  btn.textContent = ok ? '✅ Disalin!' : '❌ Gagal menyalin';
  setTimeout(() => { btn.textContent = original; }, 1800);
}

function reviewHandleAiFill(rowId, card) {
  const raw = card.querySelector('.review-ai-textarea').value;
  const msgEl = card.querySelector('.review-form-msg');
  let parsed;
  try {
    if (reviewState.jenis === 'screener') parsed = parseScreenerLine(raw, rowId);
    else if (reviewState.jenis === 'lapus') parsed = parseLapusLine(raw, rowId);
    else parsed = parsePengeluaranLine(raw, rowId);
  } catch (err) {
    alert('❌ ' + err.message);
    return;
  }
  const { hasil } = parsed;
  card.querySelector('.review-perbaiki-box').hidden = false;
  if (reviewState.jenis === 'screener') {
    const val = hasil.lolos ? 'ya' : 'tidak';
    const radio = card.querySelector(`input[name="lolos-${rowId}"][value="${val}"]`);
    if (radio) radio.checked = true;
  } else {
    const radio = card.querySelector(`input[name="relevan-${rowId}"][value="${hasil.relevan}"]`);
    if (radio) radio.checked = true;
    const codes = hasil.kategori || hasil.komponen || [];
    card.querySelectorAll('.review-code-checkbox').forEach(cb => { cb.checked = codes.includes(cb.value); });
    const arahSel = card.querySelector('.review-arah-select');
    if (arahSel) arahSel.value = hasil.arah || '';
  }
  card.querySelector('.review-alasan-input').value = hasil.alasan || '';
  if (msgEl) { msgEl.textContent = ''; msgEl.className = 'review-form-msg labeling-validation-msg'; }
}

// "Sudah dilabel": tidak ada yang berubah pada labelnya, jadi cukup satu kali
// catat "sudah direview" untuk seluruh batch. "Perlu direlabel": tiap baris
// tetap harus disubmit ulang satu-satu ke submit_label() (tidak ada versi
// bulk-nya) supaya prompt_version_id-nya ikut ter-update -- baris yang gagal
// di tengah jalan dibiarkan tetap tampil (tidak dihapus dari batch) supaya
// bisa dicoba lagi, bukan diam-diam terlewat.
async function reviewHandleBulkApprove() {
  const pending = reviewState.rows.filter(r => !r.resolved);
  if (!pending.length) return;
  const ok = confirm(`Tandai ${pending.length} baris di batch ini sebagai "sesuai, sudah direview"?`);
  if (!ok) return;
  const btn = document.getElementById('review-bulk-approve');
  btn.disabled = true;
  const succeeded = [];
  const failed = [];
  try {
    if (reviewState.scope === 'perlu_relabel') {
      btn.textContent = `Memproses 0/${pending.length}...`;
      for (let i = 0; i < pending.length; i++) {
        const row = pending[i];
        try {
          await labelingSubmit(row.id, reviewState.jenis, row.hasil);
          succeeded.push(row.id);
        } catch (err) {
          failed.push({ row, err });
        }
        btn.textContent = `Memproses ${i + 1}/${pending.length}...`;
      }
    } else {
      succeeded.push(...pending.map(r => r.id));
    }
    if (succeeded.length) {
      await reviewMarkReviewed(succeeded);
      succeeded.forEach(id => reviewRemoveCard(id));
    }
    if (failed.length) {
      alert(`${failed.length} baris gagal disimpan (dibiarkan tetap tampil untuk dicoba lagi):\n` +
        failed.map(f => `- ID ${f.row.id}: ${f.err.message}`).join('\n'));
    }
    reviewMaybeAdvance();
  } catch (err) {
    alert('Gagal menandai batch: ' + err.message);
  } finally {
    if (document.body.contains(btn)) {
      btn.disabled = false;
      btn.textContent = '✅ Semua di batch ini sesuai';
    }
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

    if (action === 'sesuai') return reviewHandleSesuai(rowId, card);
    if (action === 'lewati') return reviewHandleLewati(rowId);
    if (action === 'perbaiki-toggle') {
      card.querySelector('.review-perbaiki-box').hidden = false;
      card.querySelector('.review-ai-box').hidden = true;
      return;
    }
    if (action === 'perbaiki-cancel') {
      card.querySelector('.review-perbaiki-box').hidden = true;
      return;
    }
    if (action === 'perbaiki-submit') return reviewHandlePerbaikiSubmit(rowId, card);
    if (action === 'ai-toggle') {
      const box = card.querySelector('.review-ai-box');
      box.hidden = !box.hidden;
      return;
    }
    if (action === 'ai-copy') return reviewHandleAiCopy(row, btn);
    if (action === 'ai-fill') return reviewHandleAiFill(rowId, card);
  });
}

function initReviewPage() {
  const jenisSelect = document.getElementById('review-jenis');
  jenisSelect.value = reviewState.jenis;
  jenisSelect.addEventListener('change', () => {
    reviewState.jenis = jenisSelect.value;
    reviewEnsureActivePrompt(reviewState.jenis);
    reviewResetAndLoad();
  });

  document.querySelectorAll('.admin-tabs [data-scope]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.admin-tabs [data-scope]').forEach(b => b.classList.toggle('active', b === btn));
      reviewState.scope = btn.dataset.scope;
      reviewResetAndLoad();
    });
  });

  reviewWireListDelegation();

  reviewEnsureActivePrompt(reviewState.jenis);
  reviewResetAndLoad();
}
