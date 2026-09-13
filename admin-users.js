const ADMIN_FN_URL = 'https://cyqqohycenkoludiefgq.supabase.co/functions/v1/admin-users';

let adminUsersCache = [];
let adminActiveTab = 'recent';

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
  if (!users.length) {
    tbody.innerHTML = '<tr><td colspan="6">Tidak ada data.</td></tr>';
    return;
  }
  tbody.innerHTML = users.map(u => {
    const statusBadges = [
      u.is_admin ? '<span class="badge badge-blue">Admin</span>' : '',
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
            <button class="card-btn" onclick="resetUserPassword('${u.id}')">Reset Password</button>
            <button class="card-btn ${u.banned ? '' : 'danger'}" onclick="toggleUserBan('${u.id}', ${!u.banned})">${u.banned ? 'Aktifkan' : 'Nonaktifkan'}</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function renderActiveTab() {
  if (adminActiveTab === 'recent') {
    const recent = adminUsersCache
      .filter(u => u.last_login)
      .sort((a, b) => new Date(b.last_login) - new Date(a.last_login));
    renderAdminUsers(recent);
  } else {
    const all = [...adminUsersCache]
      .sort((a, b) => (a.nama || '').localeCompare(b.nama || '', 'id', { sensitivity: 'base' }));
    renderAdminUsers(all);
  }
}

function switchAdminTab(tab) {
  adminActiveTab = tab;
  document.getElementById('tab-btn-recent').classList.toggle('active', tab === 'recent');
  document.getElementById('tab-btn-all').classList.toggle('active', tab === 'all');
  document.getElementById('tab-btn-labeling').classList.toggle('active', tab === 'labeling');
  document.getElementById('tab-btn-detail').classList.toggle('active', tab === 'detail');

  const usersView = document.getElementById('admin-users-view');
  const labelingView = document.getElementById('admin-labeling-view');
  const detailView = document.getElementById('admin-detail-view');

  usersView.hidden = tab !== 'recent' && tab !== 'all';
  labelingView.hidden = tab !== 'labeling';
  detailView.hidden = tab !== 'detail';

  if (tab === 'labeling') {
    loadLabelingReport();
  } else if (tab === 'detail') {
    ensureLabelerOptionsLoaded().then(() => {
      syncDetailFilterInputs();
      loadDetailRows();
    });
  } else {
    renderActiveTab();
  }
}

const JENIS_LABELS = { screener: 'Screener', lapus: 'Lapangan Usaha', pengeluaran: 'Pengeluaran' };
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

    const rows = Object.entries(counts).map(([key, count]) => {
      const [date, labelerId, jenis] = key.split('|||');
      return { date, labelerId, jenis, count };
    }).sort((a, b) => {
      if (a.date !== b.date) return new Date(b.date) - new Date(a.date);
      return (nameById[a.labelerId] || '').localeCompare(nameById[b.labelerId] || '', 'id');
    });

    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="4">Belum ada aktivitas labeling dalam 30 hari terakhir.</td></tr>';
      return;
    }

    tbody.innerHTML = rows.map(r => {
      const nama = nameById[r.labelerId] || r.labelerId;
      return `
      <tr>
        <td>${escapeHtml(r.date)}</td>
        <td><button class="admin-link-btn" data-labeler-id="${escapeHtml(r.labelerId)}" data-jenis="${escapeHtml(r.jenis)}">${escapeHtml(nama)}</button></td>
        <td>${escapeHtml(JENIS_LABELS[r.jenis] || r.jenis)}</td>
        <td>${r.count}</td>
      </tr>
    `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4">Gagal memuat data: ${escapeHtml(err.message)}</td></tr>`;
  }
}

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

const detailState = { jenis: 'screener', status: 'semua', labelerId: null, page: 1, pageSize: 20, total: 0 };
let labelerOptions = [];
let labelerOptionsLoaded = false;

// Populates the "Intern" <select> once (profiles isn't admin-readable directly via
// RLS, see loadLabelingReport()'s comment, hence the admin_list_labelers RPC).
async function ensureLabelerOptionsLoaded() {
  if (labelerOptionsLoaded) return;
  try {
    const { data, error } = await window.db.rpc('admin_list_labelers');
    if (error) throw error;
    labelerOptions = data || [];
    const select = document.getElementById('detail-labeler-select');
    select.innerHTML = '<option value="">Semua Intern</option>' +
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
  detailState.page = 1;
  switchAdminTab('detail');
}

function onDetailFilterChange() {
  detailState.jenis = document.getElementById('detail-jenis').value;
  detailState.status = document.getElementById('detail-status').value;
  detailState.labelerId = document.getElementById('detail-labeler-select').value || null;
  detailState.page = 1;
  loadDetailRows();
}

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
  document.getElementById('detail-labeler-select').value = detailState.labelerId || '';
}

async function loadDetailRows() {
  const tbody = document.getElementById('admin-detail-tbody');
  tbody.innerHTML = '<tr><td colspan="6">Memuat data...</td></tr>';

  try {
    const { data, error } = await window.db.rpc('admin_labeling_detail', {
      p_jenis: detailState.jenis,
      p_status: detailState.status,
      p_labeler_id: detailState.labelerId,
      p_page: detailState.page,
      p_page_size: detailState.pageSize
    });
    if (error) throw error;
    detailState.total = data.total || 0;
    renderDetailRows(data.rows || []);
    renderDetailPagination();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6">Gagal memuat data: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderDetailRows(rows) {
  const tbody = document.getElementById('admin-detail-tbody');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="6">Tidak ada baris yang cocok dengan filter ini.</td></tr>';
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
    const labelingUrl = `${LABELING_PAGE_BY_JENIS[detailState.jenis]}?news_id=${r.id}`;
    const titleLink = `<a class="admin-link-btn" href="${escapeHtml(labelingUrl)}" target="_blank" rel="noopener" title="Buka di halaman labeling">${escapeHtml(r.title || '-')}</a>`;
    const titleCell = r.is_flagged && r.flag_reason
      ? `${titleLink}<div class="admin-muted" style="font-size:11px;margin-top:2px;">Alasan: ${escapeHtml(r.flag_reason)}</div>`
      : titleLink;
    return `
      <tr>
        <td>${r.id}</td>
        <td>${escapeHtml(formatReportDate(r.publication_datetime))}</td>
        <td class="admin-detail-title">${titleCell}</td>
        <td>${escapeHtml(r.source || '-')}</td>
        <td>${escapeHtml(r.label_value ?? '-')}</td>
        <td>${statusBadge}</td>
      </tr>
    `;
  }).join('');
}

function renderDetailPagination() {
  const maxPage = Math.max(1, Math.ceil(detailState.total / detailState.pageSize));
  document.getElementById('detail-page-info').textContent = `Halaman ${detailState.page} dari ${maxPage} (${detailState.total} baris)`;
  document.getElementById('detail-prev-btn').disabled = detailState.page <= 1;
  document.getElementById('detail-next-btn').disabled = detailState.page >= maxPage;
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
    const result = await callAdminFn('create', { nip_lama: nip, nama });
    statusEl.textContent = `Berhasil dibuat. Password default: ${result.default_password}`;
    loadAdminUsers();
  } catch (err) {
    statusEl.textContent = 'Gagal: ' + err.message;
  }
}
