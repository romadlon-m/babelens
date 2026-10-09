// Monitor Model ML (shadow mode) -- lihat SHADOW_MODE_PLAN.md (repo news-scraper-babel).
// Satu kartu per artikel, 3 kolom (Screener/Lapus/Pengeluaran) -- L2/P2 (kategori+arah)
// digabung ke kolom Lapus/Pengeluaran karena keduanya dibandingkan ke SATU baris aktual
// labeling_log yang sama (lihat admin_ml_shadow_queue_by_article() migration). Halaman ini
// sendiri tidak pernah menulis ke `news`/antrean -- tombol "Koreksi" membuka halaman
// labeling asli (submit_label()), bukan overwrite langsung.

const ML_PAGE_SIZE = 10;

const mlState = {
  onlyMismatch: true,
  dateFrom: null,
  dateTo: null,
  page: 1,
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
    mlMonitorRenderList(data.rows || [], data.total || 0);
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

function mlMonitorRenderList(rows, total) {
  const list = document.getElementById('ml-list');
  const empty = document.getElementById('ml-empty');

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

function mlRenderColumn(title, col, labelingPage, newsId, isKategori) {
  const badge = !col.has_label
    ? '<span class="badge badge-gray ml-column-badge">Belum dilabel</span>'
    : col.mismatch
      ? '<span class="badge badge-red ml-column-badge">⚠️ Berbeda</span>'
      : '<span class="badge badge-green ml-column-badge">Cocok</span>';

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

  // "Koreksi" membuka halaman labeling asli (claim_specific_news_for_labeling() +
  // submit_label()) -- TIDAK ada overwrite langsung dari halaman ini, lihat catatan
  // di atas file ini dan diskusi di riwayat chat kenapa itu berisiko.
  const correctBtn = col.has_label
    ? `<a class="card-btn" href="${labelingPage}?news_id=${newsId}" target="_blank">✏️ Koreksi</a>`
    : '<span class="ml-muted" style="font-size:12px;">Belum ada aktual untuk dikoreksi</span>';

  return `
    <div class="review-column">
      <div class="review-column-head">
        <span class="review-column-title">${title}</span>
        ${badge}
      </div>
      ${fields}
      <div class="review-column-actions">${correctBtn}</div>
    </div>
  `;
}

function mlRenderCard(row) {
  const pubDate = row.publication_datetime
    ? new Date(row.publication_datetime).toLocaleDateString('id-ID')
    : '-';

  return `
    <div class="labeling-card">
      <h3>${mlEscapeHtml(row.title || '(tanpa judul)')}</h3>
      <div class="labeling-meta">
        <span>news_id ${row.news_id}</span>
        <span>Publikasi: ${pubDate}</span>
      </div>
      <div class="review-columns">
        ${mlRenderColumn('Screener', row.screener, 'labeling-screener.html', row.news_id, false)}
        ${mlRenderColumn('Lapus (relevan + kategori + arah)', row.lapus, 'labeling-lapus.html', row.news_id, true)}
        ${mlRenderColumn('Pengeluaran (relevan + kategori + arah)', row.pengeluaran, 'labeling-pengeluaran.html', row.news_id, true)}
      </div>
    </div>
  `;
}

function mlMonitorUpdatePagination(total) {
  const totalPages = Math.max(1, Math.ceil(total / ML_PAGE_SIZE));
  document.getElementById('ml-page-info').textContent = `Halaman ${mlState.page} / ${totalPages}`;
  document.getElementById('ml-prev-btn').disabled = mlState.page <= 1;
  document.getElementById('ml-next-btn').disabled = mlState.page >= totalPages;
}
