// Monitor Model ML (shadow mode) -- lihat SHADOW_MODE_PLAN.md (repo news-scraper-babel).
// Murni observasi: tidak ada aksi apa pun dari tabel di halaman ini (beda dari
// admin-review.html yang punya tombol Sesuai/Edit), tidak ada write ke `news`/antrean.

const ML_PAGE_SIZE = 20;

const mlState = {
  jenis: 'screener',
  status: 'semua', // 'semua' | 'sudah' | 'belum'
  dateFrom: null,
  dateTo: null,
  page: 1,
};

function mlIsKategori(jenis) {
  return jenis === 'lapus_kategori' || jenis === 'pengeluaran_kategori';
}

function initMlMonitorPage() {
  mlMonitorRefresh();
}

function mlMonitorReadFilters() {
  mlState.jenis = document.getElementById('ml-jenis').value;
  mlState.status = document.getElementById('ml-status').value;
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
  const wrapper = document.getElementById('ml-table-wrapper');
  const summaryEl = document.getElementById('ml-summary-cards');
  loading.hidden = false;
  empty.hidden = true;
  wrapper.hidden = true;
  summaryEl.hidden = true;

  try {
    if (mlState.status === 'sudah') {
      await mlMonitorRenderSummary();
      const { data, error } = await window.db.rpc('admin_ml_shadow_disagreements', {
        p_jenis: mlState.jenis,
        p_date_from: mlState.dateFrom,
        p_date_to: mlState.dateTo,
        p_page: mlState.page,
        p_page_size: ML_PAGE_SIZE,
      });
      if (error) throw error;
      mlMonitorRenderTable(data.rows || [], 'disagreement', data.total || 0);
    } else {
      const hasLabel = mlState.status === 'belum' ? false : null;
      const { data, error } = await window.db.rpc('admin_ml_shadow_raw', {
        p_jenis: mlState.jenis,
        p_has_label: hasLabel,
        p_date_from: mlState.dateFrom,
        p_date_to: mlState.dateTo,
        p_page: mlState.page,
        p_page_size: ML_PAGE_SIZE,
      });
      if (error) throw error;
      mlMonitorRenderTable(data.rows || [], 'raw', data.total || 0);
    }
  } catch (err) {
    console.error('[ml-monitor]', err);
    wrapper.hidden = true;
    empty.hidden = false;
    empty.textContent = 'Gagal memuat data: ' + (err?.message || err);
  } finally {
    loading.hidden = true;
  }
}

async function mlMonitorRenderSummary() {
  const summaryEl = document.getElementById('ml-summary-cards');
  const { data, error } = await window.db.rpc('admin_ml_shadow_summary', {
    p_jenis: mlState.jenis,
    p_date_from: mlState.dateFrom,
    p_date_to: mlState.dateTo,
  });
  if (error) {
    summaryEl.hidden = true;
    return;
  }

  const cards = [];
  if (mlIsKategori(mlState.jenis)) {
    cards.push(mlStatCard('📊', 'n (sudah dilabel)', data.n ?? 0));
    cards.push(mlStatCard('🏷️', 'Kategori exact-match', mlPct(data.kategori_exact_match_ratio)));
    cards.push(mlStatCard('🧭', 'Akurasi arah', mlPct(data.arah_accuracy)));
  } else {
    cards.push(mlStatCard('📊', 'n (sudah dilabel)', data.n ?? 0));
    cards.push(mlStatCard('✅', 'Jumlah cocok', data.n_match ?? 0));
    cards.push(mlStatCard('🎯', 'Akurasi', mlPct(data.accuracy)));
  }
  summaryEl.innerHTML = cards.join('');
  summaryEl.hidden = false;
}

function mlStatCard(icon, label, value) {
  return `<div class="stat-card">
    <div class="stat-icon">${icon}</div>
    <div><div class="stat-label">${label}</div><div class="stat-value">${value}</div></div>
  </div>`;
}

function mlPct(ratio) {
  if (ratio === null || ratio === undefined) return '-';
  return (ratio * 100).toFixed(1) + '%';
}

function mlEscapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text ?? '';
  return div.innerHTML;
}

function mlFormatArr(arr) {
  if (!arr || arr.length === 0) return '<span class="ml-muted">-</span>';
  return arr.map(mlEscapeHtml).join(', ');
}

function mlFormatRelevan(value) {
  if (value === null || value === undefined) return '<span class="ml-muted">-</span>';
  return mlEscapeHtml(value);
}

function mlMonitorRenderTable(rows, mode, total) {
  const wrapper = document.getElementById('ml-table-wrapper');
  const empty = document.getElementById('ml-empty');
  const thead = document.getElementById('ml-table-head');
  const tbody = document.getElementById('ml-table-body');
  const isKategori = mlIsKategori(mlState.jenis);

  document.getElementById('ml-remaining').textContent =
    mode === 'disagreement'
      ? `${total} baris tidak cocok (prediksi ≠ label)`
      : `${total} baris`;

  if (!rows.length) {
    wrapper.hidden = true;
    empty.hidden = false;
    empty.textContent = mode === 'disagreement'
      ? 'Tidak ada disagreement untuk filter ini -- model dan labeler sepakat di semua baris yang sudah dilabel.'
      : 'Tidak ada baris untuk filter ini.';
    mlMonitorUpdatePagination(total);
    return;
  }

  empty.hidden = true;
  wrapper.hidden = false;

  const cols = isKategori
    ? ['Judul', 'Kategori Prediksi', 'Kategori Aktual', 'Arah Prediksi', 'Arah Aktual']
    : ['Judul', 'Prediksi', 'Aktual'];
  if (mode === 'raw') cols.push('Sudah Dilabel?');
  cols.push('Diprediksi Pada');

  thead.innerHTML = '<tr>' + cols.map(c => `<th>${c}</th>`).join('') + '</tr>';

  tbody.innerHTML = rows.map(r => {
    const titleCell = `<a href="news.html" onclick="return false;" title="news_id ${r.news_id}">${mlEscapeHtml(r.title || '(tanpa judul)')}</a>`;
    const cells = [titleCell];
    if (isKategori) {
      cells.push(mlFormatArr(r.predicted_kategori));
      cells.push(mlFormatArr(r.actual_kategori));
      cells.push(mlFormatRelevan(r.predicted_arah));
      cells.push(mlFormatRelevan(r.actual_arah));
    } else {
      cells.push(mlFormatRelevan(r.predicted_relevan));
      cells.push(mlFormatRelevan(r.actual_relevan));
    }
    if (mode === 'raw') cells.push(r.has_label ? 'Ya' : 'Belum');
    cells.push(r.predicted_at ? new Date(r.predicted_at).toLocaleString('id-ID') : '-');
    return '<tr>' + cells.map(c => `<td>${c}</td>`).join('') + '</tr>';
  }).join('');

  mlMonitorUpdatePagination(total);
}

function mlMonitorUpdatePagination(total) {
  const totalPages = Math.max(1, Math.ceil(total / ML_PAGE_SIZE));
  document.getElementById('ml-page-info').textContent = `Halaman ${mlState.page} / ${totalPages}`;
  document.getElementById('ml-prev-btn').disabled = mlState.page <= 1;
  document.getElementById('ml-next-btn').disabled = mlState.page >= totalPages;
}
