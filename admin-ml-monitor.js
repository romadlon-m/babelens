// Monitor Model ML (shadow mode) -- lihat SHADOW_MODE_PLAN.md (repo news-scraper-babel).
// Satu kartu per artikel, 3 kolom (Screener/Lapus/Pengeluaran) -- L2/P2 (kategori+arah)
// digabung ke kolom Lapus/Pengeluaran karena keduanya dibandingkan ke SATU baris aktual
// labeling_log yang sama (lihat admin_ml_shadow_queue_by_article() migration).
//
// "Koreksi" membuka form inline LANGSUNG di kolom (tidak pindah halaman), reuse
// reviewBuildPerbaikiFormHtml()/reviewReadPerbaikiForm() dari admin-review.js supaya
// validasi/parsing tidak diduplikasi -- submit tetap lewat labelingSubmit(..., 'review'),
// jadi TIDAK PERNAH overwrite langsung ke tabel. Hanya "Aktual" yang bisa dikoreksi;
// "Prediksi" adalah catatan historis apa kata model saat itu dan tidak pernah diedit --
// kalau Prediksi ikut diubah, tujuan shadow mode (melacak akurasi model) jadi tidak valid.

const ML_PAGE_SIZE = 10;

const mlState = {
  onlyMismatch: true,
  dateFrom: null,
  dateTo: null,
  page: 1,
  rows: [], // baris yg sedang tampil, { ...row } -- dipatch in-place setelah koreksi sukses
};

function initMlMonitorPage() {
  mlMonitorRefresh();
}

function mlMonitorReadFilters() {
  mlState.onlyMismatch = document.getElementById('ml-only-mismatch').value === 'true';
  mlState.dateFrom = document.getElementById('ml-date-from').value || null;
  mlState.dateTo = document.getElementById('ml-date-to').value || null;
}

function mlMonitorOnFilterChange() {
  mlMonitorReadFilters();
  mlState.page = 1;
  mlMonitorRefresh();
}

function mlMonitorChangePage(delta) {
  mlState.page = Math.max(1, mlState.page + delta);
  mlMonitorRefresh();
}

async function mlMonitorRefresh() {
  mlMonitorReadFilters();
  const loading = document.getElementById('ml-loading');
  const empty = document.getElementById('ml-empty');
  const list = document.getElementById('ml-list');
  loading.hidden = false;
  empty.hidden = true;
  list.hidden = true;

  try {
    const { data, error } = await window.db.rpc('admin_ml_shadow_queue_by_article', {
      p_date_from: mlState.dateFrom,
      p_date_to: mlState.dateTo,
      p_only_mismatch: mlState.onlyMismatch,
      p_page: mlState.page,
      p_page_size: ML_PAGE_SIZE,
    });
    if (error) throw error;
    mlState.rows = data.rows || [];
    mlMonitorRenderList(data.total || 0);
  } catch (err) {
    console.error('[ml-monitor]', err);
    list.hidden = true;
    empty.hidden = false;
    empty.textContent = 'Gagal memuat data: ' + (err?.message || err);
  } finally {
    loading.hidden = true;
  }
}

function mlEscapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text ?? '';
  return div.innerHTML;
}

function mlFormatArr(arr) {
  if (!arr || arr.length === 0) return '<span class="ml-muted">-</span>';
  return [...arr].sort().map(mlEscapeHtml).join(', ');
}

function mlFormatVal(value) {
  if (value === null || value === undefined) return '<span class="ml-muted">-</span>';
  return mlEscapeHtml(value);
}

function mlMonitorRenderList(total) {
  const list = document.getElementById('ml-list');
  const empty = document.getElementById('ml-empty');
  const rows = mlState.rows;

  document.getElementById('ml-remaining').textContent = mlState.onlyMismatch
    ? `${total} artikel punya minimal 1 kolom berbeda`
    : `${total} artikel sudah dilabel (minimal 1 jenis)`;

  if (!rows.length) {
    list.hidden = true;
    empty.hidden = false;
    empty.textContent = mlState.onlyMismatch
      ? 'Tidak ada disagreement untuk filter ini -- model dan labeler sepakat di semua artikel yang sudah dilabel.'
      : 'Tidak ada artikel yang sudah dilabel untuk filter ini.';
    mlMonitorUpdatePagination(total);
    return;
  }

  empty.hidden = true;
  list.hidden = false;
  list.innerHTML = rows.map(mlRenderCard).join('');
  mlMonitorUpdatePagination(total);
}

// col shape dari RPC (actual_relevan/actual_kategori/actual_arah/actual_alasan) diadaptasi
// ke shape yang reviewBuildPerbaikiFormHtml()/reviewReadPerbaikiForm() (admin-review.js)
// harapkan: col.hasil.{lolos|relevan,arah,alasan} + col[kategori_lapus|komponen_pengeluaran].
function mlColToReviewShape(jenis, col) {
  if (jenis === 'screener') {
    return { hasil: { lolos: col.actual_relevan === 'Ya' ? true : col.actual_relevan === 'Tidak' ? false : null, alasan: col.actual_alasan || '' } };
  }
  const dbField = jenis === 'lapus' ? 'kategori_lapus' : 'komponen_pengeluaran';
  return {
    hasil: { relevan: col.actual_relevan, arah: col.actual_arah, alasan: col.actual_alasan || '' },
    [dbField]: col.actual_kategori || [],
  };
}

function mlRenderColumn(jenisLabel, jenis, col, newsId) {
  const badge = !col.has_label
    ? '<span class="badge badge-gray ml-column-badge">Belum dilabel</span>'
    : col.mismatch
      ? '<span class="badge badge-red ml-column-badge">⚠️ Berbeda</span>'
      : '<span class="badge badge-green ml-column-badge">Cocok</span>';

  const isKategori = jenis !== 'screener';
  let fields = `
    <div class="ml-field-row"><span class="ml-field-label">Relevan -- Prediksi</span><span class="ml-field-value">${mlFormatVal(col.predicted_relevan)}</span></div>
    <div class="ml-field-row"><span class="ml-field-label">Relevan -- Aktual</span><span class="ml-field-value">${mlFormatVal(col.actual_relevan)}</span></div>
  `;
  if (isKategori) {
    fields += `
    <div class="ml-field-row"><span class="ml-field-label">Kategori -- Prediksi</span><span class="ml-field-value">${mlFormatArr(col.predicted_kategori)}</span></div>
    <div class="ml-field-row"><span class="ml-field-label">Kategori -- Aktual</span><span class="ml-field-value">${mlFormatArr(col.actual_kategori)}</span></div>
    <div class="ml-field-row"><span class="ml-field-label">Arah -- Prediksi</span><span class="ml-field-value">${mlFormatVal(col.predicted_arah)}</span></div>
    <div class="ml-field-row"><span class="ml-field-label">Arah -- Aktual</span><span class="ml-field-value">${mlFormatVal(col.actual_arah)}</span></div>
    `;
  }
  if (col.actual_alasan) {
    fields += `<details class="review-alasan-current"><summary>💬 ${mlEscapeHtml(col.actual_alasan)}</summary></details>`;
  }

  const koreksiBtn = col.has_label
    ? `<button class="card-btn" data-action="ml-koreksi-toggle">✏️ Koreksi</button>`
    : '<span class="ml-muted" style="font-size:12px;">Belum ada aktual untuk dikoreksi</span>';

  // Form koreksi dibangun dari reviewBuildPerbaikiFormHtml() (admin-review.js) --
  // rowId dipakai cuma utk nama radio-group unik, dipakai newsId di sini (bukan id
  // baris admin-review's own queue), supaya tiap kolom di kartu berbeda tidak kolisi.
  const perbaikiHtml = col.has_label
    ? reviewBuildPerbaikiFormHtml(jenis, newsId, mlColToReviewShape(jenis, col))
    : '';

  return `
    <div class="review-column" data-jenis="${jenis}" data-news-id="${newsId}">
      <div class="review-column-head">
        <span class="review-column-title">${jenisLabel}</span>
        ${badge}
      </div>
      ${fields}
      ${col.has_label ? `
        <div class="review-column-actions">${koreksiBtn}</div>
        <div class="review-perbaiki-box" hidden>
          ${perbaikiHtml}
          <div class="review-form-msg labeling-validation-msg"></div>
          <div class="labeling-actions">
            <button class="primary-btn" data-action="ml-koreksi-submit">Simpan</button>
            <button class="secondary-btn" data-action="ml-koreksi-cancel">Batal</button>
          </div>
        </div>
      ` : `<div class="review-column-actions">${koreksiBtn}</div>`}
    </div>
  `;
}

function mlRenderCard(row) {
  const pubDate = row.publication_datetime
    ? new Date(row.publication_datetime).toLocaleDateString('id-ID')
    : '-';

  return `
    <div class="labeling-card" data-news-id="${row.news_id}">
      <h3>${mlEscapeHtml(row.title || '(tanpa judul)')}</h3>
      <div class="labeling-meta">
        <span>news_id ${row.news_id}</span>
        <span>Publikasi: ${pubDate}</span>
      </div>
      ${row.summary ? `<details class="review-summary-toggle"><summary>Ringkasan</summary><div class="review-summary">${mlEscapeHtml(row.summary)}</div></details>` : ''}
      <div class="review-columns">
        ${mlRenderColumn('Screener', 'screener', row.screener, row.news_id)}
        ${mlRenderColumn('Lapus', 'lapus', row.lapus, row.news_id)}
        ${mlRenderColumn('Pengeluaran', 'pengeluaran', row.pengeluaran, row.news_id)}
      </div>
    </div>
  `;
}

// Setelah koreksi sukses, patch state.rows + re-render kartu itu saja di tempat
// (tidak reload seluruh halaman/kehilangan posisi halaman) -- hitung ulang mismatch
// client-side dgn logika yg sama persis dgn RPC (relevan ATAU kategori ATAU arah beda).
function mlRecomputeMismatch(jenis, col) {
  if (jenis === 'screener') {
    col.mismatch = col.has_label && col.predicted_relevan !== col.actual_relevan;
    return;
  }
  const predSet = new Set(col.predicted_kategori || []);
  const actSet = new Set(col.actual_kategori || []);
  const sameSet = predSet.size === actSet.size && [...predSet].every(k => actSet.has(k));
  col.mismatch = col.has_label && (
    col.predicted_relevan !== col.actual_relevan ||
    !sameSet ||
    col.predicted_arah !== col.actual_arah
  );
}

// Kalau Screener dikoreksi jadi "Tidak Lolos", Lapus & Pengeluaran ikut dipaksa
// relevan='Tidak' + kategori/komponen+arah kosong -- artikel yang tidak lolos
// pengecekan awal secara definisi tidak bisa relevan Lapus/Pengeluaran. Ini perilaku
// yang SUDAH ADA di submit_label() tapi cuma utk baris batch2 (lihat "Batch 2 relabel
// flow" di CLAUDE.md) -- di sini diterapkan eksplisit utk SEMUA baris lewat 2 submit
// terpisah, bukan mengandalkan logika batch2 yang bersyarat itu.
async function mlCascadeTidakLolos(newsId, row, screenerAlasan) {
  for (const jenis of ['lapus', 'pengeluaran']) {
    const field = jenis === 'lapus' ? 'kategori' : 'komponen';
    const alasan = `Otomatis mengikuti Screener (Tidak Lolos): ${screenerAlasan}`;
    const hasil = { relevan: 'Tidak', [field]: [], arah: null, alasan };
    try {
      await labelingSubmit(newsId, jenis, hasil, 'review');
      const col = row[jenis];
      col.has_label = true;
      col.actual_relevan = 'Tidak';
      col.actual_kategori = [];
      col.actual_arah = null;
      col.actual_alasan = alasan;
      mlRecomputeMismatch(jenis, col);
    } catch (err) {
      console.error(`[ml-monitor] gagal cascade ${jenis}:`, err);
    }
  }
}

async function mlHandleKoreksiSubmit(newsId, jenis, colEl, row) {
  const msgEl = colEl.querySelector('.review-form-msg');
  msgEl.textContent = '';
  msgEl.className = 'review-form-msg labeling-validation-msg';
  let hasil;
  try {
    ({ hasil } = reviewReadPerbaikiForm(jenis, colEl, newsId));
  } catch (err) {
    msgEl.textContent = '❌ ' + err.message;
    msgEl.classList.add('error');
    return;
  }
  msgEl.textContent = 'Menyimpan...';
  try {
    await labelingSubmit(newsId, jenis, hasil, 'review');

    const col = row[jenis];
    col.actual_relevan = hasil.lolos !== undefined
      ? (hasil.lolos ? 'Ya' : 'Tidak')
      : hasil.relevan;
    col.actual_kategori = hasil.kategori || hasil.komponen || [];
    col.actual_arah = hasil.arah ?? null;
    col.actual_alasan = hasil.alasan || '';
    mlRecomputeMismatch(jenis, col);

    if (jenis === 'screener' && hasil.lolos === false) {
      await mlCascadeTidakLolos(newsId, row, hasil.alasan);
    }

    const cardEl = document.querySelector(`.labeling-card[data-news-id="${newsId}"]`);
    if (cardEl) cardEl.outerHTML = mlRenderCard(row);
  } catch (err) {
    msgEl.textContent = '❌ Gagal menyimpan: ' + err.message;
    msgEl.classList.add('error');
  }
}

function mlWireListDelegation() {
  document.getElementById('ml-list').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const colEl = e.target.closest('.review-column');
    if (!colEl) return;
    const jenis = colEl.dataset.jenis;
    const newsId = parseInt(colEl.dataset.newsId, 10);
    const row = mlState.rows.find(r => r.news_id === newsId);
    const action = btn.dataset.action;

    if (action === 'ml-koreksi-toggle') {
      colEl.querySelector('.review-perbaiki-box').hidden = false;
      return;
    }
    if (action === 'ml-koreksi-cancel') {
      colEl.querySelector('.review-perbaiki-box').hidden = true;
      return;
    }
    if (action === 'ml-koreksi-submit') return mlHandleKoreksiSubmit(newsId, jenis, colEl, row);
  });
}

function mlMonitorUpdatePagination(total) {
  const totalPages = Math.max(1, Math.ceil(total / ML_PAGE_SIZE));
  document.getElementById('ml-page-info').textContent = `Halaman ${mlState.page} / ${totalPages}`;
  document.getElementById('ml-prev-btn').disabled = mlState.page <= 1;
  document.getElementById('ml-next-btn').disabled = mlState.page >= totalPages;
}

mlWireListDelegation();
