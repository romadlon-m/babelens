const ADMIN_FN_URL = 'https://cyqqohycenkoludiefgq.supabase.co/functions/v1/admin-users';

let adminUsersCache = [];
let adminActiveTab = 'recent';
const adminUsersFilter = { search: '', role: 'semua', status: 'semua' };
const adminUsersSort = { col: null, dir: 'asc' };

function renderSortIndicator(containerSelector, sortState) {
  document.querySelectorAll(`${containerSelector} thead th[data-sort]`).forEach(th => {
    th.classList.remove('sorted-asc', 'sorted-desc');
    if (sortState.col && th.dataset.sort === sortState.col) {
      th.classList.add(sortState.dir === 'asc' ? 'sorted-asc' : 'sorted-desc');
    }
  });
}

function adminUserStatusSortKey(u) {
  return [
    u.banned ? 'Nonaktif' : 'Aktif',
    u.is_admin ? 'Admin' : '',
    u.is_labeler ? 'Labeler' : '',
    u.must_change_password ? 'BelumGantiPassword' : ''
  ].join('|');
}

function compareAdminUsers(a, b, col) {
  switch (col) {
    case 'nip':
      return (a.nip_lama || '').localeCompare(b.nip_lama || '');
    case 'nama':
      return (a.nama || '').localeCompare(b.nama || '', 'id', { sensitivity: 'base' });
    case 'email':
      return (a.google_email || '').localeCompare(b.google_email || '', 'id', { sensitivity: 'base' });
    case 'status':
      return adminUserStatusSortKey(a).localeCompare(adminUserStatusSortKey(b));
    case 'login': {
      const va = a.last_login ? new Date(a.last_login).getTime() : -Infinity;
      const vb = b.last_login ? new Date(b.last_login).getTime() : -Infinity;
      return va - vb;
    }
    default:
      return 0;
  }
}

function sortAdminUsers(list) {
  if (!adminUsersSort.col) return list;
  const sorted = [...list].sort((a, b) => compareAdminUsers(a, b, adminUsersSort.col));
  if (adminUsersSort.dir === 'desc') sorted.reverse();
  return sorted;
}

function onAdminUsersSortClick(col) {
  if (adminUsersSort.col === col) {
    adminUsersSort.dir = adminUsersSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    adminUsersSort.col = col;
    adminUsersSort.dir = 'asc';
  }
  renderActiveTab();
}

document.addEventListener('DOMContentLoaded', () => {
  const thead = document.querySelector('#admin-users-view thead');
  if (!thead) return;
  thead.addEventListener('click', (e) => {
    const th = e.target.closest('th[data-sort]');
    if (!th) return;
    onAdminUsersSortClick(th.dataset.sort);
  });
});

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

async function callAdminFn(action, payload = {}) {
  const { data: { session } } = await window.db.auth.getSession();
  if (!session) throw new Error('Sesi tidak valid');
  const res = await fetch(ADMIN_FN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${session.access_token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ action, ...payload })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || 'Terjadi kesalahan');
  return body;
}

function formatLastLogin(iso) {
  if (!iso) return 'Belum pernah';
  const d = new Date(iso);
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

function renderAdminUsers(users) {
  const tbody = document.getElementById('admin-users-tbody');
  renderSortIndicator('#admin-users-view', adminUsersSort);
  if (!users.length) {
    tbody.innerHTML = '<tr><td colspan="6">Tidak ada data.</td></tr>';
    return;
  }
  tbody.innerHTML = users.map(u => {
    const statusBadges = [
      u.is_admin ? '<span class="badge badge-blue">Admin</span>' : '',
      u.is_labeler ? '<span class="badge" style="background:#ede9fe;color:#6d28d9;">Labeler</span>' : '',
      u.must_change_password ? '<span class="badge badge-gray">Belum ganti password</span>' : '',
      u.banned ? '<span class="badge" style="background:#fee2e2;color:#dc2626;">Nonaktif</span>' : '<span class="badge badge-green">Aktif</span>'
    ].filter(Boolean).join(' ');

    return `
      <tr>
        <td>${escapeHtml(u.nip_lama)}</td>
        <td>${escapeHtml(u.nama)}</td>
        <td>${u.google_email ? escapeHtml(u.google_email) : '<span class="admin-muted">Belum terhubung</span>'}</td>
        <td>${statusBadges}</td>
        <td>${formatLastLogin(u.last_login)}</td>
        <td>
          <div class="admin-actions">
            <button class="card-btn" data-edit-user-id="${u.id}">Edit</button>
            <button class="card-btn" onclick="resetUserPassword('${u.id}')">Reset Password</button>
            <button class="card-btn ${u.banned ? '' : 'danger'}" onclick="toggleUserBan('${u.id}', ${!u.banned})">${u.banned ? 'Aktifkan' : 'Nonaktifkan'}</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function matchesAdminUsersFilter(u) {
  const { search, role, status } = adminUsersFilter;
  if (search) {
    const haystack = `${u.nama || ''} ${u.nip_lama || ''}`.toLowerCase();
    if (!haystack.includes(search)) return false;
  }
  if (role === 'admin' && !u.is_admin) return false;
  if (role === 'labeler' && !u.is_labeler) return false;
  if (role === 'biasa' && (u.is_admin || u.is_labeler)) return false;
  if (status === 'aktif' && u.banned) return false;
  if (status === 'nonaktif' && !u.banned) return false;
  if (status === 'belum_ganti_password' && !u.must_change_password) return false;
  return true;
}

function onAdminFilterChange() {
  adminUsersFilter.search = document.getElementById('admin-search').value.trim().toLowerCase();
  adminUsersFilter.role = document.getElementById('admin-filter-role').value;
  adminUsersFilter.status = document.getElementById('admin-filter-status').value;
  renderActiveTab();
}

function renderActiveTab() {
  let base;
  if (adminActiveTab === 'recent') {
    base = adminUsersCache
      .filter(u => u.last_login)
      .sort((a, b) => new Date(b.last_login) - new Date(a.last_login));
  } else {
    base = [...adminUsersCache]
      .sort((a, b) => (a.nama || '').localeCompare(b.nama || '', 'id', { sensitivity: 'base' }));
  }
  renderAdminUsers(sortAdminUsers(base.filter(matchesAdminUsersFilter)));
}

function switchAdminTab(tab) {
  adminActiveTab = tab;
  document.getElementById('tab-btn-recent').classList.toggle('active', tab === 'recent');
  document.getElementById('tab-btn-all').classList.toggle('active', tab === 'all');
  document.getElementById('tab-btn-labeling').classList.toggle('active', tab === 'labeling');
  document.getElementById('tab-btn-detail').classList.toggle('active', tab === 'detail');
  document.getElementById('tab-btn-prompts').classList.toggle('active', tab === 'prompts');

  const usersFilters = document.getElementById('admin-users-filters');
  const usersView = document.getElementById('admin-users-view');
  const labelingView = document.getElementById('admin-labeling-view');
  const detailView = document.getElementById('admin-detail-view');
  const promptsView = document.getElementById('admin-prompts-view');

  usersFilters.hidden = tab !== 'recent' && tab !== 'all';
  usersView.hidden = tab !== 'recent' && tab !== 'all';
  labelingView.hidden = tab !== 'labeling';
  detailView.hidden = tab !== 'detail';
  promptsView.hidden = tab !== 'prompts';

  if (tab === 'labeling') {
    loadLabelingReport();
  } else if (tab === 'detail') {
    Promise.all([
      ensureLabelerOptionsLoaded(),
      ensurePromptVersiOptionsLoaded(detailState.jenis)
    ]).then(() => {
      syncDetailFilterInputs();
      loadDetailRows();
    });
  } else if (tab === 'prompts') {
    loadAllPrompts();
  } else {
    renderActiveTab();
  }
}

const JENIS_LABELS = { screener: 'Pengecekan Awal', lapus: 'Lapangan Usaha', pengeluaran: 'Pengeluaran' };
const LABELING_PAGE_BY_JENIS = { screener: 'labeling-screener.html', lapus: 'labeling-lapus.html', pengeluaran: 'labeling-pengeluaran.html' };

function formatReportDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Monitoring produktivitas intern (LABELING_TOOL_PLAN.md bagian 7): jumlah submit per
// intern/jenis/hari, dihitung dari labeling_log. Nama diambil dari adminUsersCache
// (dimuat lewat Edge Function admin-users) karena RLS profiles tidak mengizinkan
// klien admin membaca profil user lain langsung — labeling_log sendiri sudah
// mengizinkan admin membaca semua baris (lihat migrasi labeling_tool_schema).
async function loadLabelingReport() {
  const tbody = document.getElementById('admin-labeling-tbody');
  tbody.innerHTML = '<tr><td colspan="4">Memuat data...</td></tr>';

  try {
    if (!adminUsersCache.length) {
      const { users } = await callAdminFn('list');
      adminUsersCache = users || [];
    }
    const nameById = {};
    adminUsersCache.forEach(u => { nameById[u.id] = u.nama; });

    const since = new Date();
    since.setDate(since.getDate() - 30);

    const { data, error } = await window.db
      .from('labeling_log')
      .select('labeler_id, jenis, created_at')
      .gte('created_at', since.toISOString())
      .order('created_at', { ascending: false });

    if (error) throw error;

    const counts = {}; // key: date|labeler_id|jenis -> count
    (data || []).forEach(row => {
      const date = formatReportDate(row.created_at);
      const key = `${date}|||${row.labeler_id}|||${row.jenis}`;
      counts[key] = (counts[key] || 0) + 1;
    });

    labelingReportRows = Object.entries(counts).map(([key, count]) => {
      const [date, labelerId, jenis] = key.split('|||');
      return { date, labelerId, jenis, count, nama: nameById[labelerId] || labelerId };
    });
    renderLabelingReportRows();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4">Gagal memuat data: ${escapeHtml(err.message)}</td></tr>`;
  }
}

let labelingReportRows = [];
const labelingSort = { col: 'date', dir: 'desc' };

function compareLabelingRows(a, b, col) {
  switch (col) {
    case 'date':
      return new Date(a.date) - new Date(b.date);
    case 'nama':
      return (a.nama || '').localeCompare(b.nama || '', 'id', { sensitivity: 'base' });
    case 'jenis':
      return (JENIS_LABELS[a.jenis] || a.jenis).localeCompare(JENIS_LABELS[b.jenis] || b.jenis, 'id');
    case 'count':
      return a.count - b.count;
    default:
      return 0;
  }
}

function renderLabelingReportRows() {
  const tbody = document.getElementById('admin-labeling-tbody');
  renderSortIndicator('#admin-labeling-view', labelingSort);
  if (!labelingReportRows.length) {
    tbody.innerHTML = '<tr><td colspan="4">Belum ada aktivitas labeling dalam 30 hari terakhir.</td></tr>';
    return;
  }
  const sorted = [...labelingReportRows].sort((a, b) => {
    const cmp = compareLabelingRows(a, b, labelingSort.col);
    return labelingSort.dir === 'asc' ? cmp : -cmp;
  });
  tbody.innerHTML = sorted.map(r => `
      <tr>
        <td>${escapeHtml(r.date)}</td>
        <td><button class="admin-link-btn" data-labeler-id="${escapeHtml(r.labelerId)}" data-jenis="${escapeHtml(r.jenis)}">${escapeHtml(r.nama)}</button></td>
        <td>${escapeHtml(JENIS_LABELS[r.jenis] || r.jenis)}</td>
        <td>${r.count}</td>
      </tr>
    `).join('');
}

function onLabelingSortClick(col) {
  if (labelingSort.col === col) {
    labelingSort.dir = labelingSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    labelingSort.col = col;
    labelingSort.dir = col === 'date' ? 'desc' : 'asc';
  }
  renderLabelingReportRows();
}

document.addEventListener('DOMContentLoaded', () => {
  const thead = document.querySelector('#admin-labeling-view thead');
  if (!thead) return;
  thead.addEventListener('click', (e) => {
    const th = e.target.closest('th[data-sort]');
    if (!th) return;
    onLabelingSortClick(th.dataset.sort);
  });
});

// Delegated so it survives every loadLabelingReport() re-render, and so intern
// names (may contain quotes/apostrophes) never need inline-onclick escaping.
document.addEventListener('DOMContentLoaded', () => {
  const tbody = document.getElementById('admin-labeling-tbody');
  if (!tbody) return;
  tbody.addEventListener('click', (e) => {
    const btn = e.target.closest('.admin-link-btn');
    if (!btn) return;
    openDetailForLabeler(btn.dataset.labelerId, btn.dataset.jenis);
  });
});

// --- Detail Baris tab: per-`news`-row labeling status, server-side filtered and
// paginated via the admin_labeling_detail RPC (see supabase/migrations/
// 20260913140000_labeling_admin_detail.sql) so this stays fast as `news` grows. ---

const detailState = {
  jenis: 'screener', status: 'semua', labelerId: null, page: 1, pageSize: 20, total: 0,
  sortCol: 'tanggal', sortDir: 'desc',
  label: '', source: '', dateFrom: null, dateTo: null, promptVersi: ''
};
let labelerOptions = [];
let labelerOptionsLoaded = false;

// Label vocab is a closed, per-jenis set (matches labelingFormatExistingLabel()'s
// values in labeling-common.js) — no need for a distinct-values query.
const DETAIL_LABEL_OPTIONS = {
  screener: ['Lolos', 'Tidak Lolos'],
  lapus: ['Ya', 'Tidak'],
  pengeluaran: ['Ya', 'Tidak']
};

function renderDetailLabelOptions() {
  const select = document.getElementById('detail-label-filter');
  const options = DETAIL_LABEL_OPTIONS[detailState.jenis] || [];
  select.innerHTML = '<option value="">Semua</option>' +
    options.map(o => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('');
  select.value = detailState.label || '';
}

// Populates the "Labeler" <select> once (profiles isn't admin-readable directly via
// RLS, see loadLabelingReport()'s comment, hence the admin_list_labelers RPC).
async function ensureLabelerOptionsLoaded() {
  if (labelerOptionsLoaded) return;
  try {
    const { data, error } = await window.db.rpc('admin_list_labelers');
    if (error) throw error;
    labelerOptions = data || [];
    const select = document.getElementById('detail-labeler-select');
    select.innerHTML = '<option value="">Semua Labeler</option>' +
      labelerOptions.map(l => `<option value="${escapeHtml(l.id)}">${escapeHtml(l.nama)}</option>`).join('');
    labelerOptionsLoaded = true;
  } catch (err) {
    console.error('Gagal memuat daftar intern:', err);
  }
}

function openDetailForLabeler(labelerId, jenis) {
  detailState.labelerId = labelerId;
  detailState.jenis = jenis;
  detailState.status = 'sudah';
  detailState.label = '';
  detailState.promptVersi = '';
  detailState.source = '';
  detailState.dateFrom = null;
  detailState.dateTo = null;
  detailState.page = 1;
  switchAdminTab('detail');
}

// Prompt-version filter options: label_prompts' SELECT policy already allows
// any authenticated user to read every row (active or not), same as the
// "Kelola Prompt" tab's own read — but loaded independently here (not reused
// from promptHistoryByJenis) since Detail Baris can be opened before the
// Kelola Prompt tab has ever loaded.
let promptVersiOptionsByJenis = { screener: null, lapus: null, pengeluaran: null };

async function ensurePromptVersiOptionsLoaded(jenis) {
  if (!promptVersiOptionsByJenis[jenis]) {
    try {
      const { data, error } = await window.db
        .from('label_prompts')
        .select('versi, created_at')
        .eq('jenis', jenis)
        .order('created_at', { ascending: false });
      if (error) throw error;
      promptVersiOptionsByJenis[jenis] = data || [];
    } catch (err) {
      console.error('Gagal memuat daftar versi prompt:', err);
      promptVersiOptionsByJenis[jenis] = [];
    }
  }
  renderPromptVersiOptions();
}

function renderPromptVersiOptions() {
  const select = document.getElementById('detail-prompt-versi-filter');
  const options = promptVersiOptionsByJenis[detailState.jenis] || [];
  select.innerHTML = '<option value="">Semua</option>' +
    options.map(o => `<option value="${escapeHtml(o.versi)}">${escapeHtml(o.versi)}</option>`).join('');
  select.value = detailState.promptVersi || '';
}

function onDetailFilterChange() {
  const newJenis = document.getElementById('detail-jenis').value;
  if (newJenis !== detailState.jenis) {
    detailState.jenis = newJenis;
    detailState.label = ''; // label vocab differs per jenis, so a stale value can't carry over
    detailState.promptVersi = ''; // prompt versions differ per jenis too
    renderDetailLabelOptions();
    ensurePromptVersiOptionsLoaded(newJenis);
  }
  detailState.status = document.getElementById('detail-status').value;
  detailState.label = document.getElementById('detail-label-filter').value;
  detailState.promptVersi = document.getElementById('detail-prompt-versi-filter').value;
  detailState.source = document.getElementById('detail-source').value.trim();
  detailState.dateFrom = document.getElementById('detail-date-from').value || null;
  detailState.dateTo = document.getElementById('detail-date-to').value || null;
  detailState.labelerId = document.getElementById('detail-labeler-select').value || null;
  detailState.page = 1;
  loadDetailRows();
}

let detailSourceDebounceTimer = null;
function onDetailSourceInput() {
  clearTimeout(detailSourceDebounceTimer);
  detailSourceDebounceTimer = setTimeout(onDetailFilterChange, 350);
}

function onDetailSortClick(col) {
  if (detailState.sortCol === col) {
    detailState.sortDir = detailState.sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    detailState.sortCol = col;
    detailState.sortDir = (col === 'tanggal' || col === 'no') ? 'desc' : 'asc';
  }
  detailState.page = 1;
  loadDetailRows();
}

document.addEventListener('DOMContentLoaded', () => {
  const thead = document.querySelector('#admin-detail-view table thead');
  if (!thead) return;
  thead.addEventListener('click', (e) => {
    const th = e.target.closest('th[data-sort]');
    if (!th) return;
    onDetailSortClick(th.dataset.sort);
  });
});

function changeDetailPage(delta) {
  const maxPage = Math.max(1, Math.ceil(detailState.total / detailState.pageSize));
  const next = detailState.page + delta;
  if (next < 1 || next > maxPage) return;
  detailState.page = next;
  loadDetailRows();
}

function syncDetailFilterInputs() {
  document.getElementById('detail-jenis').value = detailState.jenis;
  document.getElementById('detail-status').value = detailState.status;
  renderDetailLabelOptions();
  renderPromptVersiOptions();
  document.getElementById('detail-source').value = detailState.source || '';
  document.getElementById('detail-date-from').value = detailState.dateFrom || '';
  document.getElementById('detail-date-to').value = detailState.dateTo || '';
  document.getElementById('detail-labeler-select').value = detailState.labelerId || '';
}

async function loadDetailRows() {
  const tbody = document.getElementById('admin-detail-tbody');
  tbody.innerHTML = '<tr><td colspan="8">Memuat data...</td></tr>';

  try {
    const { data, error } = await window.db.rpc('admin_labeling_detail', {
      p_jenis: detailState.jenis,
      p_status: detailState.status,
      p_labeler_id: detailState.labelerId,
      p_page: detailState.page,
      p_page_size: detailState.pageSize,
      p_sort_col: detailState.sortCol,
      p_sort_dir: detailState.sortDir,
      p_label: detailState.label || null,
      p_source: detailState.source || null,
      p_date_from: detailState.dateFrom || null,
      p_date_to: detailState.dateTo || null,
      p_prompt_versi: detailState.promptVersi || null
    });
    if (error) throw error;
    detailState.total = data.total || 0;
    renderSortIndicator('#admin-detail-view', { col: detailState.sortCol, dir: detailState.sortDir });
    renderDetailRows(data.rows || []);
    renderDetailPagination();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8">Gagal memuat data: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderDetailRows(rows) {
  const tbody = document.getElementById('admin-detail-tbody');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="8">Tidak ada baris yang cocok dengan filter ini.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(r => {
    const statusBadge = r.is_flagged
      ? '<span class="badge" style="background:#fee2e2;color:#dc2626;">🚩 Ditandai</span>'
      : r.label_value == null
        ? '<span class="badge badge-gray">Belum dilabel</span>'
        : r.needs_relabel
          ? '<span class="badge" style="background:#fef3c7;color:#b45309;">Perlu direlabel</span>'
          : '<span class="badge badge-green">Sudah dilabel</span>';
    // Only meaningful for Screener: this is the same "already has lapus/pengeluaran
    // data from the pre-tool manual pass" group the Screener queue itself already
    // deprioritizes (see claim_next_news_for_labeling) — shown here so admins see
    // the same distinction, not just the labeler-facing queue order.
    const legacyBadge = (detailState.jenis === 'screener' && r.legacy_labeled)
      ? ' <span class="badge badge-gray" title="Sudah punya data lapus/pengeluaran dari proses manual dulu">🗂️ Data Lama</span>'
      : '';
    const labelingUrl = `${LABELING_PAGE_BY_JENIS[detailState.jenis]}?news_id=${r.id}`;
    const titleLink = `<a class="admin-link-btn admin-detail-title-link" href="${escapeHtml(labelingUrl)}" target="_blank" rel="noopener" title="${escapeHtml(r.title || '-')}">${escapeHtml(r.title || '-')}</a>`;
    const titleCell = r.is_flagged && r.flag_reason
      ? `${titleLink}<div class="admin-muted admin-detail-note" title="${escapeHtml(r.flag_reason)}">Alasan: ${escapeHtml(r.flag_reason)}</div>`
      : titleLink;
    // Click (not hover) to reveal "alasan" — a hover tooltip risks the same
    // clipping bug already documented for `.tooltip::after` inside a scrolling
    // ancestor (this table wrapper has overflow). Revealed as a separate
    // colspan row below (not inline under the label cell) so it can never
    // change this row's column widths under the fixed table layout.
    const alasanRowId = `detail-alasan-${detailState.jenis}-${r.id}`;
    const hasAlasan = !!r.alasan;
    const labelCell = hasAlasan
      ? `<span class="admin-link-btn" style="cursor:pointer" onclick="toggleDetailAlasan('${alasanRowId}')" title="Klik untuk lihat/sembunyikan alasan">${escapeHtml(r.label_value ?? '-')} 💬</span>`
      : escapeHtml(r.label_value ?? '-');
    const mainRow = `
      <tr>
        <td>${r.id}</td>
        <td>${escapeHtml(formatReportDate(r.publication_datetime))}</td>
        <td class="admin-detail-title">${titleCell}</td>
        <td>${escapeHtml(r.source || '-')}</td>
        <td>${labelCell}</td>
        <td>${escapeHtml(r.prompt_versi || '-')}</td>
        <td>${escapeHtml(r.labeler_nama || '-')}</td>
        <td>${statusBadge}${legacyBadge}</td>
      </tr>
    `;
    const expandRow = hasAlasan ? `
      <tr id="${alasanRowId}" class="admin-detail-expand-row" hidden>
        <td colspan="8">
          <div class="admin-detail-expand">
            <div class="admin-detail-expand-block">
              <strong>Alasan label</strong>
              <p>${escapeHtml(r.alasan)}</p>
            </div>
            <div class="admin-detail-expand-block">
              <strong>Ringkasan berita</strong>
              <p>${r.summary ? escapeHtml(r.summary) : '<span class="admin-muted">Belum ada ringkasan.</span>'}</p>
            </div>
            <div class="admin-detail-expand-actions">
              <a class="card-btn" href="${escapeHtml(labelingUrl)}" target="_blank" rel="noopener">🔍 Review Label</a>
            </div>
          </div>
        </td>
      </tr>
    ` : '';
    return mainRow + expandRow;
  }).join('');
}

function toggleDetailAlasan(id) {
  const el = document.getElementById(id);
  if (el) el.hidden = !el.hidden;
}

function renderDetailPagination() {
  const maxPage = Math.max(1, Math.ceil(detailState.total / detailState.pageSize));
  document.getElementById('detail-page-info').textContent = `Halaman ${detailState.page} dari ${maxPage} (${detailState.total} baris)`;
  document.getElementById('detail-prev-btn').disabled = detailState.page <= 1;
  document.getElementById('detail-next-btn').disabled = detailState.page >= maxPage;
}

// --- Kelola Prompt tab: view/edit label_prompts. "Simpan Versi Baru" always
// creates a new row via admin_update_label_prompt() rather than editing the
// active row's isi_prompt in place — see that RPC's migration for why (breaks
// admin_labeling_detail()'s "perlu_relabel" audit trail otherwise). Reading is a
// plain client query since label_prompts' SELECT policy already allows any
// authenticated user to read every row, active or not. ---

const PROMPT_JENIS_LIST = ['screener', 'lapus', 'pengeluaran'];
let promptHistoryByJenis = { screener: [], lapus: [], pengeluaran: [] };

async function loadAllPrompts() {
  await Promise.all(PROMPT_JENIS_LIST.map(loadPromptHistory));
}

async function loadPromptHistory(jenis) {
  const metaEl = document.getElementById(`prompt-meta-${jenis}`);
  try {
    const { data, error } = await window.db
      .from('label_prompts')
      .select('id, versi, isi_prompt, is_active, created_at')
      .eq('jenis', jenis)
      .order('created_at', { ascending: false });
    if (error) throw error;
    promptHistoryByJenis[jenis] = data || [];
    renderPromptEditor(jenis);
  } catch (err) {
    metaEl.textContent = 'Gagal memuat: ' + err.message;
  }
}

function renderPromptEditor(jenis) {
  const rows = promptHistoryByJenis[jenis] || [];
  const metaEl = document.getElementById(`prompt-meta-${jenis}`);
  const select = document.getElementById(`prompt-history-${jenis}`);
  const textarea = document.getElementById(`prompt-textarea-${jenis}`);

  if (!rows.length) {
    metaEl.textContent = 'Belum ada prompt untuk jenis ini.';
    select.innerHTML = '';
    textarea.value = '';
    return;
  }

  const active = rows.find(r => r.is_active) || rows[0];
  metaEl.textContent = rows.find(r => r.is_active)
    ? `Versi aktif: ${active.versi} • Dibuat ${formatReportDate(active.created_at)}`
    : `Tidak ada versi aktif — menampilkan versi terbaru (${active.versi}).`;

  select.innerHTML = rows.map(r =>
    `<option value="${escapeHtml(r.id)}">${escapeHtml(r.versi)} (${escapeHtml(formatReportDate(r.created_at))})${r.is_active ? ' • Aktif' : ''}</option>`
  ).join('');
  select.value = active.id;
  textarea.value = active.isi_prompt;
}

function onPromptHistorySelect(jenis) {
  const select = document.getElementById(`prompt-history-${jenis}`);
  const textarea = document.getElementById(`prompt-textarea-${jenis}`);
  const row = (promptHistoryByJenis[jenis] || []).find(r => r.id === select.value);
  if (row) textarea.value = row.isi_prompt;
}

async function savePrompt(jenis) {
  const textarea = document.getElementById(`prompt-textarea-${jenis}`);
  const versiInput = document.getElementById(`prompt-versi-${jenis}`);
  const statusEl = document.getElementById(`prompt-status-${jenis}`);
  const isiPrompt = textarea.value;

  if (!isiPrompt.trim()) {
    statusEl.textContent = 'Isi prompt tidak boleh kosong.';
    statusEl.className = 'labeling-validation-msg error';
    return;
  }
  if (!confirm(`Simpan versi baru untuk prompt "${JENIS_LABELS[jenis]}"? Versi ini akan langsung aktif dipakai labeler; versi lama tetap tersimpan di riwayat.`)) {
    return;
  }

  statusEl.textContent = 'Menyimpan...';
  statusEl.className = 'labeling-validation-msg';
  try {
    const { data, error } = await window.db.rpc('admin_update_label_prompt', {
      p_jenis: jenis,
      p_isi_prompt: isiPrompt,
      p_versi: versiInput.value.trim() || null
    });
    if (error) throw error;
    versiInput.value = '';
    statusEl.textContent = `Tersimpan sebagai versi "${data.versi}".`;
    await loadPromptHistory(jenis);
  } catch (err) {
    statusEl.textContent = 'Gagal menyimpan: ' + err.message;
    statusEl.className = 'labeling-validation-msg error';
  }
}

// Delegated (like the labeling-report name links) so re-renders of the users
// table never need re-binding, and so it survives switching between the
// "Sudah Pernah Login" / "Seluruh Pegawai" tabs sharing the same tbody.
document.addEventListener('DOMContentLoaded', () => {
  const tbody = document.getElementById('admin-users-tbody');
  if (!tbody) return;
  tbody.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-edit-user-id]');
    if (!btn) return;
    openEditModal(btn.dataset.editUserId);
  });
});

function openEditModal(userId) {
  const user = adminUsersCache.find(u => u.id === userId);
  if (!user) return;
  document.getElementById('edit-user-id').value = userId;
  document.getElementById('edit-nip').value = user.nip_lama || '';
  document.getElementById('edit-nama').value = user.nama || '';
  document.getElementById('edit-is-labeler').checked = !!user.is_labeler;
  document.getElementById('edit-status').textContent = '';
  document.getElementById('admin-edit-modal-overlay').classList.add('open');
}

function closeEditModal(event, force) {
  if (force || !event || event.target.id === 'admin-edit-modal-overlay') {
    document.getElementById('admin-edit-modal-overlay').classList.remove('open');
  }
}

async function submitEditUser() {
  const userId = document.getElementById('edit-user-id').value;
  const nip = document.getElementById('edit-nip').value.trim();
  const nama = document.getElementById('edit-nama').value.trim();
  const isLabeler = document.getElementById('edit-is-labeler').checked;
  const statusEl = document.getElementById('edit-status');

  if (!/^\d{9}$/.test(nip)) {
    statusEl.textContent = 'NIP harus 9 digit angka.';
    return;
  }
  if (!nama) {
    statusEl.textContent = 'Nama wajib diisi.';
    return;
  }

  statusEl.textContent = 'Menyimpan...';
  try {
    await callAdminFn('update-profile', { user_id: userId, nip_lama: nip, nama, is_labeler: isLabeler });
    statusEl.textContent = 'Berhasil disimpan.';
    adminUsersCache = [];
    await loadAdminUsers();
    setTimeout(() => closeEditModal(null, true), 600);
  } catch (err) {
    statusEl.textContent = 'Gagal: ' + err.message;
  }
}

async function loadAdminUsers() {
  const tbody = document.getElementById('admin-users-tbody');
  try {
    const { users } = await callAdminFn('list');
    adminUsersCache = users || [];
    renderActiveTab();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6">Gagal memuat data: ${escapeHtml(err.message)}</td></tr>`;
  }
}

async function resetUserPassword(userId) {
  if (!confirm('Reset password pengguna ini ke password default? Pengguna akan diminta mengganti password saat login berikutnya.')) return;
  try {
    const result = await callAdminFn('reset-password', { user_id: userId });
    alert(`Password direset ke: ${result.default_password}`);
  } catch (err) {
    alert('Gagal reset password: ' + err.message);
  }
}

async function toggleUserBan(userId, ban) {
  const confirmMsg = ban ? 'Nonaktifkan akun ini?' : 'Aktifkan kembali akun ini?';
  if (!confirm(confirmMsg)) return;
  try {
    await callAdminFn('toggle-ban', { user_id: userId, ban });
    loadAdminUsers();
  } catch (err) {
    alert('Gagal memperbarui status akun: ' + err.message);
  }
}

function openAdminModal() {
  document.getElementById('admin-new-nip').value = '';
  document.getElementById('admin-new-nama').value = '';
  document.getElementById('admin-new-is-labeler').checked = false;
  document.getElementById('admin-status').textContent = '';
  document.getElementById('admin-modal-overlay').classList.add('open');
}

function closeAdminModal(event, force) {
  if (force || !event || event.target.id === 'admin-modal-overlay') {
    document.getElementById('admin-modal-overlay').classList.remove('open');
  }
}

async function submitNewUser() {
  const nip = document.getElementById('admin-new-nip').value.trim();
  const nama = document.getElementById('admin-new-nama').value.trim();
  const isLabeler = document.getElementById('admin-new-is-labeler').checked;
  const statusEl = document.getElementById('admin-status');

  if (!/^\d{9}$/.test(nip)) {
    statusEl.textContent = 'NIP harus 9 digit angka.';
    return;
  }
  if (!nama) {
    statusEl.textContent = 'Nama wajib diisi.';
    return;
  }

  statusEl.textContent = 'Menyimpan...';
  try {
    const result = await callAdminFn('create', { nip_lama: nip, nama, is_labeler: isLabeler });
    statusEl.textContent = `Berhasil dibuat. Password default: ${result.default_password}`;
    loadAdminUsers();
  } catch (err) {
    statusEl.textContent = 'Gagal: ' + err.message;
  }
}
