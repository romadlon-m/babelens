const db = window.db;

const QUICK_KEYWORDS = [
  'timah', 'lada', 'kaolin', 'sawit', 'ekspor', 'investasi',
  'ekonomi', 'pariwisata', 'inflasi', 'umkm', 'tambang', 'perikanan'
];

// ====================================
// LAPUS LABELS
// ====================================
const LAPUS_LABELS = {
  A: "Pertanian, Kehutanan, dan Perikanan",
  B: "Pertambangan dan Penggalian",
  C: "Industri Pengolahan",
  D: "Pengadaan Listrik dan Gas",
  E: "Pengadaan Air, Pengelolaan Sampah, Limbah dan Daur Ulang",
  F: "Konstruksi",
  G: "Perdagangan Besar dan Eceran; Reparasi Mobil dan Sepeda Motor",
  H: "Transportasi dan Pergudangan",
  I: "Penyediaan Akomodasi dan Makan Minum",
  J: "Informasi dan Komunikasi",
  K: "Jasa Keuangan dan Asuransi",
  L: "Real Estat",
  MN: "Jasa Perusahaan",
  O: "Administrasi Pemerintahan, Pertahanan dan Jaminan Sosial Wajib",
  P: "Jasa Pendidikan",
  Q: "Jasa Kesehatan dan Kegiatan Sosial",
  RSTU: "Jasa Lainnya"
};


const PENGELUARAN_LABELS = {
  '1a': 'Makanan dan Minuman Non Alkohol',
  '1b': 'Minuman Beralkohol dan Rokok',
  '1c': 'Pakaian',
  '1d': 'Perumahan, Air, Listrik, Energi',
  '1e': 'Perabot dan Perlengkapan Rumah Tangga',
  '1f': 'Kesehatan',
  '1g': 'Transportasi',
  '1h': 'Komunikasi',
  '1i': 'Rekreasi dan Budaya',
  '1j': 'Pendidikan',
  '1k': 'Hotel dan Penginapan',
  '1l': 'Barang Pribadi dan Jasa Lainnya',
  '1':  'Pengeluaran Konsumsi Rumah Tangga',
  '2':  'Pengeluaran Konsumsi LNPRT',
  '3':  'Pengeluaran Konsumsi Pemerintah',
  '4':  'Pembentukan Modal Tetap Bruto',
  '5':  'Perubahan Inventori',
  '6':  'Ekspor Luar Negeri',
  '7':  'Impor Luar Negeri'
};



let lastParams = {};
let currentRows = [];
let hiddenCount = 0;

function getPageSize() {
  return parseInt(sessionStorage.getItem('page_size') || '10', 10);
}

// Defaults populated on first load from the DB
let defaultMinDate = null;
let defaultMaxDate = null;

// LABEL CUTOFF: Tanggal artikel terlabeli terbaru dari pelabelan 22k (Copilot, Juli 2026).
// Artikel setelah tanggal ini belum memiliki lu_relevan/pengeluaran_relevan (NULL)
// dan akan tampil dengan badge "Dalam Proses Analisis".
// Update nilai ini setelah batch pelabelan berikutnya selesai diupload ke Supabase.
// Terakhir diupdate: 2 Agustus 2026 (pelabelan batch 1, ~22k artikel).
const LABEL_CUTOFF = '2026-07-18';


// ====================================
// NEWS SEARCH SKELETON LOADER
// ====================================
function renderNewsSearchSkeleton(count = 4) {
  const card = `
    <div class="news-search-skeleton">
      <div class="skeleton-line skeleton-title"></div>
      <div class="skeleton-line skeleton-meta"></div>
      <div class="skeleton-line skeleton-summary"></div>
      <div class="skeleton-line skeleton-summary"></div>
    </div>
  `;
  return card.repeat(count);
}

// ====================================
// FORMAT DATE
// ====================================
function formatDateIndo(dateString) {
  const d = new Date(dateString);
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  }).format(d);
}


// ====================================
// SCOPE CHIP TOGGLE
// ====================================
function toggleScope(id, btn) {
  const cb = document.getElementById(id);
  cb.checked = !cb.checked;
  btn.classList.toggle('active', cb.checked);
  search(1);
}

// ====================================
// CHIP KATA KUNCI POPULER
// ====================================
function renderQuickKeywordChips() {
  const wrap = document.getElementById('quick-keyword-chips');
  if (!wrap) return;

  wrap.innerHTML = QUICK_KEYWORDS.map(kw => `
    <button type="button" class="scope-chip" data-kw="${kw}" onclick="applyQuickKeyword('${kw}', this)">${kw}</button>
  `).join('');
}

function applyQuickKeyword(kw, btn) {
  keyword.value = kw;
  updateKeywordClearVisibility();
  document.querySelectorAll('#quick-keyword-chips .scope-chip').forEach(chip => {
    chip.classList.toggle('active', chip === btn);
  });
  search(1);
}

function toggleQuickKeywordChips() {
  const wrap = document.getElementById('quick-keyword-chips');
  const btn = document.getElementById('quick-keyword-toggle');
  const willShow = !wrap.classList.contains('chips-visible');
  wrap.classList.toggle('chips-visible', willShow);
  btn.classList.toggle('open', willShow);
}

// ====================================
// URUTKAN HASIL
// ====================================
let sortOrder = 'desc';

function sortCurrentRows() {
  currentRows.sort((a, b) => {
    const da = new Date(a.publication_datetime).getTime();
    const dbb = new Date(b.publication_datetime).getTime();
    return sortOrder === 'asc' ? da - dbb : dbb - da;
  });
}

// ====================================
// PRESET PERIODE (NEWS SEARCH)
// ====================================
function buildNewsPresetOptions() {
  const now      = new Date();
  const thisYear = now.getFullYear();
  const thisMonth = now.getMonth(); // 0-indexed

  const BULAN_NAMA = [
    'Januari','Februari','Maret','April','Mei','Juni',
    'Juli','Agustus','September','Oktober','November','Desember'
  ];

  // ── Triwulan ──────────────────────────────────────────
  const groupTw = document.getElementById('news-preset-group-tw');
  const quarters = [
    { label: `Triwulan I ${thisYear}  (Jan–Mar)`,  from: `${thisYear}-01-01`, to: `${thisYear}-03-31`, endMonth: 2  },
    { label: `Triwulan II ${thisYear} (Apr–Jun)`,  from: `${thisYear}-04-01`, to: `${thisYear}-06-30`, endMonth: 5  },
    { label: `Triwulan III ${thisYear} (Jul–Sep)`, from: `${thisYear}-07-01`, to: `${thisYear}-09-30`, endMonth: 8  },
    { label: `Triwulan IV ${thisYear} (Okt–Des)`,  from: `${thisYear}-10-01`, to: `${thisYear}-12-31`, endMonth: 11 }
  ];
  quarters.forEach(q => {
    const opt = document.createElement('option');
    opt.value = `tw|${q.from}|${q.to}`;
    opt.textContent = q.label;
    if (thisMonth < q.endMonth - 2) opt.disabled = true;
    groupTw.appendChild(opt);
  });

  // ── Bulanan: Januari s.d. bulan ini ──────────────────
  const groupBln = document.getElementById('news-preset-group-bln');
  for (let m = 0; m <= thisMonth; m++) {
    const opt     = document.createElement('option');
    const mm      = String(m + 1).padStart(2, '0');
    const lastDay = new Date(thisYear, m + 1, 0).getDate();
    opt.value     = `bln|${thisYear}-${mm}-01|${thisYear}-${mm}-${lastDay}`;
    opt.textContent = `${BULAN_NAMA[m]} ${thisYear}`;
    groupBln.appendChild(opt);
  }
}

function applyNewsPreset() {
  const val      = document.getElementById('news_preset').value;
  const maxDate = defaultMaxDate || new Date().toISOString().split('T')[0];
  const now     = new Date();
  const y       = now.getFullYear();

  if (!val) return;

  let from, to;

  if (val === '30d') {
    const d = new Date(); d.setDate(d.getDate() - 30);
    from = d.toISOString().split('T')[0];
    to   = maxDate;
  } else if (val === 'year') {
    from = `${y}-01-01`;
    to   = maxDate;
  } else {
    const [, f, t] = val.split('|');
    from = f;
    to   = t > maxDate ? maxDate : t;
  }

  date_from.value = from;
  date_to.value   = to;
  search(1);
}

// ====================================
// FILTER KATA KUNCI (AND antar kata, OR antar kolom scope)
// ====================================
function splitKeywordWords(keyword) {
  // %,()  are stripped: % is an ILIKE wildcard, and ,() have special
  // meaning inside PostgREST's .or() filter DSL used by applyKeywordFilter.
  const cleaned = (keyword || '').replace(/[%,()]/g, '');
  const tokens = [];
  const re = /"([^"]+)"|(\S+)/g;
  let match;
  while ((match = re.exec(cleaned)) !== null) {
    const token = (match[1] || match[2] || '').trim().replace(/\s+/g, ' ');
    if (token) tokens.push(token);
  }
  return tokens;
}

function applyKeywordFilter(query, params) {
  if (!params.keyword) return query;

  const words = splitKeywordWords(params.keyword);

  words.forEach(word => {
    const parts = [];
    if (params.f_title)   parts.push(`title.ilike.%${word}%`);
    if (params.f_summary) parts.push(`summary.ilike.%${word}%`);
    if (params.f_full)    parts.push(`content.ilike.%${word}%`);
    if (parts.length) query = query.or(parts.join(','));
  });

  return query;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightKeyword(text, words) {
  const escaped = escapeHtml(String(text ?? ''));
  if (!words || !words.length) return escaped;
  const pattern = words.map(escapeRegExp).join('|');
  if (!pattern) return escaped;
  const re = new RegExp(`(${pattern})`, 'gi');
  return escaped.replace(re, '<mark class="keyword-highlight">$1</mark>');
}

// ====================================
// CARI
// ====================================
async function search(page = 1) {

  if (
    !f_title.checked &&
    !f_summary.checked &&
    !f_full.checked
  ) {
    alert("Pilih minimal satu kolom pencarian.");
    return;
  }

  if (
    date_to.value &&
    date_from.value &&
    date_to.value < date_from.value
  ) {
    date_to.value = date_from.value;
  }

  lastParams = {
    keyword: keyword.value,
    region: region.value,
    lapus: lapus.value,
    pengeluaran: document.getElementById('pengeluaran_filter').value,
    pdrb_relevan: pdrb_only.checked,
    event_time: Array.from(
      document.querySelectorAll(".event_filter:checked")
    ).map(cb => cb.value).join(","),
    date_from: date_from.value,
    date_to: date_to.value,
    f_title: f_title.checked,
    f_summary: f_summary.checked,
    f_full: f_full.checked
  };

  result.innerHTML = renderNewsSearchSkeleton();

  const BATCH = 1000;
  const eventTimes = lastParams.event_time ? lastParams.event_time.split(',') : [];

  async function fetchRows() {
    let allRows = [];
    let from = 0;

    while (true) {
      let query = db.from('news')
        .select('*')
        .order('publication_datetime', { ascending: false })
        .range(from, from + BATCH - 1);

      if (lastParams.region)       query = query.eq('region_final', lastParams.region);
      if (lastParams.lapus)        query = query.contains('kategori_lapus', [lastParams.lapus]);
      if (lastParams.pengeluaran)  query = query.contains('komponen_pengeluaran', [lastParams.pengeluaran]);
      if (lastParams.pdrb_relevan) query = query.or('lu_relevan.eq.Ya,pengeluaran_relevan.eq.Ya');
      if (lastParams.date_from)    query = query.gte('publication_datetime', lastParams.date_from);
      if (lastParams.date_to)      query = query.lte('publication_datetime', lastParams.date_to + 'T23:59:59');
      if (eventTimes.length > 0 && eventTimes.length < 3) query = query.in('event_time', eventTimes);
      query = applyKeywordFilter(query, lastParams);

      const { data: rows, error } = await query;

      if (error) {
        console.error(error);
        result.innerHTML = `<div class="news-card">Gagal memuat data.</div>`;
        return null;
      }

      allRows = allRows.concat(rows || []);
      if (!rows || rows.length < BATCH) break;
      from += BATCH;
    }

    return allRows;
  }

  async function fetchHiddenTotal() {
    if (!lastParams.pdrb_relevan) return 0;

    let query = db.from('news')
      .select('*', { count: 'exact', head: true });

    if (lastParams.region)       query = query.eq('region_final', lastParams.region);
    if (lastParams.lapus)        query = query.contains('kategori_lapus', [lastParams.lapus]);
    if (lastParams.pengeluaran)  query = query.contains('komponen_pengeluaran', [lastParams.pengeluaran]);
    if (lastParams.date_from)    query = query.gte('publication_datetime', lastParams.date_from);
    if (lastParams.date_to)      query = query.lte('publication_datetime', lastParams.date_to + 'T23:59:59');
    if (eventTimes.length > 0 && eventTimes.length < 3) query = query.in('event_time', eventTimes);
    query = applyKeywordFilter(query, lastParams);

    const { count } = await query;
    return count || 0;
  }

  const [allRows, totalCount] = await Promise.all([fetchRows(), fetchHiddenTotal()]);

  if (allRows === null) return;

  if (lastParams.pdrb_relevan) {
    hiddenCount = Math.max(0, totalCount - allRows.length);
  } else {
    hiddenCount = 0;
  }

  currentRows = allRows;
  sortCurrentRows();
  renderPage(1);

  const { data: { session } } = await db.auth.getSession();
  if (session) {
    db.from('user_events').insert({
      user_id: session.user.id,
      event_type: 'search',
      payload: lastParams
    }).then(({ error }) => { if (error) console.error(error); });
  }
}


// ====================================
// TAMPILKAN HALAMAN
// ====================================
function renderPage(page = 1) {

  const totalFound = currentRows.length;
  const pageSize = getPageSize();
  const totalPages = Math.max(1, Math.ceil(totalFound / pageSize));
  const start = (page - 1) * pageSize;
  const end = start + pageSize;
  const rows = currentRows.slice(start, end);

  const showingStart = totalFound === 0 ? 0 : start + 1;
  const showingEnd = start + rows.length;

  const keywordWords = splitKeywordWords(lastParams.keyword);

  const keywordNotice = lastParams.keyword
    ? ` • Kata kunci: "<b>${highlightKeyword(lastParams.keyword, keywordWords)}</b>"`
    : '';

  meta.innerHTML = `
    Ditemukan <b>${totalFound.toLocaleString('id-ID')}</b> artikel • Halaman <b>${page}</b> dari <b>${totalPages.toLocaleString('id-ID')}</b> • Menampilkan <b>${showingStart.toLocaleString('id-ID')}</b>–<b>${showingEnd.toLocaleString('id-ID')}</b>${keywordNotice}
  `;

  const pdrbNotice = document.getElementById('pdrb-notice');
  pdrbNotice.innerHTML = hiddenCount > 0
    ? `<div class="pdrb-notice-bar"><b>${hiddenCount.toLocaleString('id-ID')}</b> berita non-PDRB tersembunyi — <a href="#" onclick="showAllPdrb(event)">Nonaktifkan filter PDRB</a></div>`
    : '';

  if (!rows.length) {
    const hasKeyword = !!lastParams.keyword;
    const hasFilters = !!(
      lastParams.region || lastParams.lapus || lastParams.pengeluaran || lastParams.pdrb_relevan
    );

    let hint = 'Coba ubah kata kunci atau perlonggar filter pencarian.';
    if (hasKeyword && hasFilters) {
      hint = `Tidak ada artikel yang cocok dengan kata kunci "<b>${escapeHtml(lastParams.keyword)}</b>" dan filter yang aktif. Coba kurangi filter atau ubah kata kunci.`;
    } else if (hasKeyword) {
      hint = `Tidak ada artikel yang memuat semua kata dari "<b>${escapeHtml(lastParams.keyword)}</b>". Coba kata kunci yang lebih singkat atau berbeda.`;
    } else if (hasFilters) {
      hint = 'Coba perlonggar filter yang aktif (wilayah, lapangan usaha, komponen pengeluaran, atau Hanya PDRB Relevan).';
    }

    result.innerHTML = `
      <div class="news-card no-results-card">
        <div class="no-results-icon">🔍</div>
        <div class="no-results-title">Tidak ada hasil ditemukan</div>
        <div class="no-results-hint">${hint}</div>
      </div>
    `;
    pager.innerHTML = "";
    return;
  }

  let html = "";

  rows.forEach((r) => {

    const formattedDate = formatDateIndo(r.publication_datetime);
    const citationText = `${r.title} (${r.source}, ${formattedDate})`;
    const summaryText = `${r.title}\n${r.summary}`;

    const highlightedTitle = highlightKeyword(r.title, keywordWords);
    const highlightedSummary = highlightKeyword(r.summary || "-", keywordWords);
    const highlightedContent = highlightKeyword(r.content || "-", keywordWords);

    // Relevansi PDRB: Ya jika relevan LU atau Pengeluaran
    // NULL berarti artikel belum terlabeli (di luar rentang pelabelan batch 1)
    const isLabeled = r.lu_relevan !== null && r.lu_relevan !== undefined;
    const isRelevant = r.lu_relevan === 'Ya' || r.pengeluaran_relevan === 'Ya';

    // Lapangan Usaha: array → join untuk display, tooltip label panjang
    const lapusArr = r.kategori_lapus || [];
    const lapusShort = lapusArr.join(', ') || '-';
    const lapusLong = lapusArr.map(k => `${k} - ${LAPUS_LABELS[k] || k}`).join('\n');

    // Komponen Pengeluaran
    const pengArr  = r.komponen_pengeluaran || [];
    const pengShort = pengArr.join(', ') || '-';
    const pengLong  = pengArr.map(k => `${k} - ${PENGELUARAN_LABELS[k] || k}`).join('\n');

    html += `
      <article class="news-card">

        <div class="news-header">
          <div>
            <h3 class="news-title">
              <a href="${r.url}" target="_blank">
                ${highlightedTitle}
              </a>
            </h3>
            <div class="news-meta">
              ${formattedDate}
              •
              ${r.region_final || r.region || "-"}
              •
              ${r.source}
            </div>
          </div>
        </div>

        <div class="news-summary">
          ${highlightedSummary}
          <span
            class="tooltip info-icon"
            data-tooltip="Ringkasan dibuat menggunakan AI. Harap verifikasi jika diperlukan."
          >
            i
          </span>
        </div>

        <div class="badges">

          <span
            class="badge tooltip ${isLabeled ? (isRelevant ? "badge-green" : "badge-gray") : "badge-gray"}"
            data-tooltip="${isLabeled
              ? `PDRB: ${isRelevant ? 'YA' : 'TIDAK'} · LU: ${r.lu_relevan || '-'} · Pengeluaran: ${r.pengeluaran_relevan || '-'} — Label dibuat otomatis oleh AI. Relevansi mencakup keterkaitan langsung maupun tidak langsung dengan PDRB — gunakan sebagai panduan awal, bukan keputusan final.`
              : "Belum dianalisis. Label akan tersedia pada batch berikutnya."}"
          >
            ${isLabeled ? `PDRB: ${isRelevant ? "YA" : "TIDAK"}` : "Dalam Proses Analisis"}
          </span>

          ${lapusArr.length > 0 ? `
            <span
              class="badge badge-blue tooltip"
              data-tooltip="${lapusLong} — Dibuat menggunakan model Machine Learning terlatih. Harap verifikasi jika diperlukan."
            >
              Lapus: ${lapusShort}
            </span>
          ` : ""}

          ${pengArr.length > 0 ? `
            <span
              class="badge badge-blue tooltip"
              data-tooltip="${pengLong} — Dibuat menggunakan klasifikasi AI. Harap verifikasi jika diperlukan."
              style="background:#fef3c7;color:#92400e;"
            >
              Peng: ${pengShort}
            </span>
          ` : ""}

          ${r.event_time ? `
            <span
              class="badge badge-gray tooltip"
              data-tooltip="Status kejadian dibuat menggunakan ekstraksi AI. Harap verifikasi jika diperlukan."
            >
              ${r.event_time}
            </span>
          ` : ""}

        </div>

        <div class="card-actions">

          <button
            class="card-btn"
            onclick='copyText(${JSON.stringify(citationText)}, this)'
          >
            Salin Kutipan
          </button>

          <button
            class="card-btn"
            onclick='copyText(${JSON.stringify(summaryText)}, this)'
          >
            Salin Ringkasan
          </button>

          <button
            class="card-btn"
            onclick="toggleArticle(this)"
            data-url="${r.url}"
          >
            Artikel Lengkap
          </button>

        </div>

        <div class="full-article">${highlightedContent}</div>

      </article>
    `;
  });

  result.innerHTML = html;
  renderPager(page, totalPages);
  updateUrl(page);

  requestAnimationFrame(() => {
    const pagerEl = document.querySelector('.pager.fixed-bottom');
    const pagerHeight = pagerEl ? pagerEl.getBoundingClientRect().height : 0;
    const paddingBottom = pagerHeight + 16 + 8;
    result.style.paddingBottom = paddingBottom + 'px';
    console.log('Parent element: #result (.cards-container)');
    console.log('Pager height (getBoundingClientRect):', pagerHeight + 'px');
    console.log('Final padding-bottom applied:', paddingBottom + 'px');
  });

  window.scrollTo({ top: 0, behavior: "smooth" });
}


function updateUrl(page) {
  try {
    const url = new URL(window.location);
    const params = url.searchParams;
    params.set('page', page);
    params.set('page_size', getPageSize());
    history.replaceState(null, '', url.pathname + '?' + params.toString());
  } catch (e) {
    // ignore
  }
}


// ====================================
// NAVIGASI HALAMAN
// ====================================
function renderPager(page, totalPages) {

  let html = "";

  if (page > 1) {
    html += `<button onclick="renderPage(1)" title="Halaman Pertama">«</button>`;
    html += `<button onclick="renderPage(${page - 1})" title="Sebelumnya">‹</button>`;
  }

  for (let i = 1; i <= totalPages; i++) {
    if (i >= page - 2 && i <= page + 2) {
      html += `
        <button
          class="${i === page ? 'active' : ''}"
          onclick="renderPage(${i})"
        >
          ${i}
        </button>
      `;
    }
  }

  if (page < totalPages) {
    html += `<button onclick="renderPage(${page + 1})" title="Berikutnya">›</button>`;
    html += `<button onclick="renderPage(${totalPages})" title="Halaman Terakhir">»</button>`;
  }

  if (totalPages > 5) {
    html += `
      <span class="pager-jump">
        <label for="jump_page_input">ke hal.</label>
        <input
          type="number"
          id="jump_page_input"
          min="1"
          max="${totalPages}"
          placeholder="${page}"
          onkeydown="if (event.key === 'Enter') jumpToPage(${totalPages})"
        >
        <button type="button" onclick="jumpToPage(${totalPages})" title="Ke halaman ini" aria-label="Ke halaman ini">→</button>
      </span>
    `;
  }

  pager.innerHTML = html;
}

function jumpToPage(totalPages) {
  const input = document.getElementById('jump_page_input');
  let target = parseInt(input.value, 10);
  if (!target || target < 1) target = 1;
  if (target > totalPages) target = totalPages;
  renderPage(target);
}


// ====================================
// SALIN TEKS
// ====================================
function copyText(text, btn) {
  navigator.clipboard.writeText(text);
  const original = btn.textContent;
  btn.textContent = "✓ Tersalin!";
  btn.disabled = true;
  setTimeout(() => {
    btn.textContent = original;
    btn.disabled = false;
  }, 1500);
}


// ====================================
// TAMPILKAN/SEMBUNYIKAN ARTIKEL
// ====================================
function toggleArticle(btn) {
  const article = btn.parentElement.nextElementSibling;
  article.classList.toggle("show");
  btn.textContent = article.classList.contains("show")
    ? "Sembunyikan"
    : "Artikel Lengkap";

  if (article.classList.contains("show")) {
    (async () => {
      const { data: { session } } = await db.auth.getSession();
      if (session) {
        db.from('user_events').insert({
          user_id: session.user.id,
          event_type: 'article_expand',
          payload: { url: btn.dataset.url }
        }).then(({ error }) => { if (error) console.error(error); });
      }
    })();
  }
}


// ====================================
// TAMPILKAN SEMUA (NONAKTIFKAN FILTER PDRB)
// ====================================
function showAllPdrb(e) {
  e.preventDefault();
  pdrb_only.checked = false;
  localStorage.setItem("babelens_pdrb_filter", "false");
  search(1);
}


// ====================================
// RESET
// ====================================
function resetSearch() {

  keyword.value = "";
  updateKeywordClearVisibility();
  region.value = "";
  lapus.value = "";
  document.getElementById('pengeluaran_filter').value = "";
  document.getElementById('news_preset').value = "30d";  pdrb_only.checked = false;
  localStorage.setItem("babelens_pdrb_filter", "false");
  f_title.checked = true;
  f_summary.checked = true;
  f_full.checked = false;
  // Sync chips ke state checkbox
  document.querySelectorAll('.scope-chip').forEach(chip => {
    const cb = document.getElementById(chip.dataset.cb);
    if (cb) chip.classList.toggle('active', cb.checked);
  });

  document.querySelectorAll('#quick-keyword-chips .scope-chip').forEach(chip => {
    chip.classList.remove('active');
  });

  sortOrder = 'desc';
  document.getElementById('sort_select').value = 'desc';

  document.querySelectorAll(".event_filter").forEach(cb => cb.checked = true);

  const maxD = defaultMaxDate || new Date().toISOString().split('T')[0];
  const minD = (() => {
    const d = new Date(maxD);
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  })();

  date_from.value = minD;
  date_to.value   = maxD;

  search(1);
}


// ====================================
// EVENT OTOMATIS PENCARIAN
// ====================================
["region", "lapus", "pengeluaran_filter", "date_from", "date_to"]
  .forEach(id => {
    document.getElementById(id).addEventListener("change", () => search(1));
  });

document.getElementById('news_preset').addEventListener('change', applyNewsPreset);

document.getElementById('sort_select').addEventListener('change', function () {
  sortOrder = this.value;
  sortCurrentRows();
  renderPage(1);
});

pdrb_only.addEventListener("change", () => {
  localStorage.setItem("babelens_pdrb_filter", pdrb_only.checked);
  search(1);
});

document.querySelectorAll(".event_filter").forEach(cb => {
  cb.addEventListener("change", () => search(1));
});

/* Page size change handler: calculates the first visible article index based on the current page and old page size, updates the page size in sessionStorage, then calculates the new page number to render so that the same articles remain visible. After rendering the new page, it scrolls to the article that was at the top of the viewport before the change. */
document.getElementById("page_size_select").addEventListener("change", function () {
  const oldPageSize = getPageSize();
  const currentPage = parseInt(new URL(window.location).searchParams.get('page') || '1', 10);
  const firstVisibleIndex = (currentPage - 1) * oldPageSize;

  const newPageSize = parseInt(this.value, 10);
  sessionStorage.setItem('page_size', this.value);

  const newPage = Math.floor(firstVisibleIndex / newPageSize) + 1;
  renderPage(newPage);

  const cardIndex = firstVisibleIndex % newPageSize;
  const cards = result.querySelectorAll('article.news-card');
  if (cardIndex > 0 && cards[cardIndex]) {
    cards[cardIndex].scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
});

keyword.addEventListener("keydown", e => {
  if (e.key === "Enter") search(1);
});

const keywordClearBtn = document.getElementById('keyword_clear');
const keywordSearchBtn = document.getElementById('keyword_search_btn');

document.getElementById('quick-keyword-toggle').addEventListener('click', toggleQuickKeywordChips);

function updateKeywordClearVisibility() {
  keywordClearBtn.classList.toggle('visible', keyword.value.length > 0);
}

keyword.addEventListener('input', updateKeywordClearVisibility);
updateKeywordClearVisibility();

keywordClearBtn.addEventListener('click', () => {
  keyword.value = '';
  updateKeywordClearVisibility();
  document.querySelectorAll('#quick-keyword-chips .scope-chip').forEach(chip => {
    chip.classList.remove('active');
  });
  keyword.focus();
  search(1);
});

keywordSearchBtn.addEventListener('click', () => search(1));

function updatePagerVisibility() {
  const pager = document.getElementById("pager");
  if (!pager) return;
  if (window.scrollY >= 300) {
    pager.classList.add("visible");
  } else {
    pager.classList.remove("visible");
  }
}

window.addEventListener("scroll", updatePagerVisibility);
window.addEventListener("load", updatePagerVisibility);

// ====================================
// VALIDASI TANGGAL
// ====================================
date_from.addEventListener("change", function () {
  if (this.value) {
    date_to.min = this.value;
    if (date_to.value && date_to.value < this.value) {
      date_to.value = "";
    }
  }
});

date_to.addEventListener("change", function () {
  if (this.value && this.value < date_from.value) {
    this.value = "";
  }
});


// ====================================
// MUAT PERTAMA KALI
// ====================================
window.onload = async () => {

  const { data } = await db.from('news')
    .select('publication_datetime')
    .order('publication_datetime', { ascending: false })
    .limit(1);

  let maxDate, minDate;

  if (data && data.length > 0) {
    const latest = new Date(data[0].publication_datetime);
    const earliest = new Date(latest);
    earliest.setDate(earliest.getDate() - 30);
    maxDate = latest.toISOString().split('T')[0];
    minDate = earliest.toISOString().split('T')[0];
  } else {
    const today = new Date();
    maxDate = today.toISOString().split('T')[0];
    const fallback = new Date();
    fallback.setDate(fallback.getDate() - 30);
    minDate = fallback.toISOString().split('T')[0];
  }

  defaultMinDate = minDate;
  defaultMaxDate = maxDate;

  date_from.value = minDate;
  date_to.value   = maxDate;
  date_from.max = maxDate;
  date_to.max = maxDate;

  const datasetMin = "2025-10-01";
  date_from.min = datasetMin;
  date_to.min = date_from.value || datasetMin;

  document.getElementById("page_size_select").value = getPageSize();

  buildNewsPresetOptions();
  renderQuickKeywordChips();

  pdrb_only.checked = localStorage.getItem("babelens_pdrb_filter") === "true";

  document.querySelectorAll('#feedback-stars span').forEach(s => {
    s.addEventListener('click', () => {
      feedbackRating = parseInt(s.dataset.value);
      updateStars(feedbackRating);
    });
  });

  search(1);
};


// ====================================
// EKSPOR KE EXCEL
// ====================================
function exportToExcel() {

  if (!currentRows || currentRows.length === 0) {
    alert("Tidak ada data untuk diekspor.");
    return;
  }

  const exportData = currentRows.map((r, i) => {
    const isRelevant = r.lu_relevan === 'Ya' || r.pengeluaran_relevan === 'Ya';
    const lapusArr = r.kategori_lapus || [];
    const pengArr  = r.komponen_pengeluaran || [];

    const lapusLabel = code => code ? `${code} - ${LAPUS_LABELS[code] || code}` : "-";
    const pengLabel  = code => code ? `${code} - ${PENGELUARAN_LABELS[code] || code}` : "-";

    return {
      "No": i + 1,
      "Judul": r.title || "-",
      "Tanggal": r.publication_datetime ? formatDateIndo(r.publication_datetime) : "-",
      "Sumber": r.source || "-",
      "Wilayah": r.region_final || "-",
      "Kategori": r.category || "-",
      "Status Kejadian": r.event_time || "-",
      "PDRB Relevan": isRelevant ? "YA" : "TIDAK",
      "LU Relevan": r.lu_relevan || "-",
      "Lap. Usaha": lapusLabel(lapusArr[0]),
      "Lap. Usaha 2": lapusLabel(lapusArr[1]),
      "Pengeluaran Relevan": r.pengeluaran_relevan || "-",
      "Komp. Pengeluaran": pengLabel(pengArr[0]),
      "Komp. Pengeluaran 2": pengLabel(pengArr[1]),
      "Ringkasan": r.summary || "-",
      "URL": r.url || "-",
      "Kutipan": r.title
        ? `${r.title} (${r.source || "-"}, ${r.publication_datetime ? formatDateIndo(r.publication_datetime) : "-"})`
        : "-",
    };
  });

  const ws = XLSX.utils.json_to_sheet(exportData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Babelens");

  ws['!cols'] = [
    { wch: 5  },  // No
    { wch: 50 },  // Judul
    { wch: 18 },  // Tanggal
    { wch: 20 },  // Sumber
    { wch: 20 },  // Wilayah
    { wch: 20 },  // Kategori
    { wch: 18 },  // Status Kejadian
    { wch: 15 },  // PDRB Relevan
    { wch: 12 },  // LU Relevan
    { wch: 45 },  // Lap. Usaha
    { wch: 45 },  // Lap. Usaha 2
    { wch: 18 },  // Pengeluaran Relevan
    { wch: 40 },  // Komp. Pengeluaran
    { wch: 40 },  // Komp. Pengeluaran 2
    { wch: 60 },  // Ringkasan
    { wch: 40 },  // URL
    { wch: 80 },  // Kutipan
  ];

  const filename = `babelens_${date_from.value}_${date_to.value}.xlsx`;
  XLSX.writeFile(wb, filename);

  (async () => {
    const { data: { session } } = await db.auth.getSession();
    if (session) {
      db.from('user_events').insert({
        user_id: session.user.id,
        event_type: 'export_excel',
        payload: { row_count: currentRows.length, filters: lastParams }
      }).then(({ error }) => { if (error) console.error(error); });
    }
  })();
}


// ====================================
// UMPAN BALIK
// ====================================
let feedbackRating = 0;

function openFeedback() {
  feedbackRating = 0;
  document.getElementById('feedback-message').value = '';
  document.getElementById('feedback-status').textContent = '';
  document.getElementById('feedback-submit').disabled = false;
  updateStars(0);
  document.getElementById('feedback-overlay').classList.add('open');
}

function closeFeedback(e, force = false) {
  if (force || (e && e.target === document.getElementById('feedback-overlay'))) {
    document.getElementById('feedback-overlay').classList.remove('open');
  }
}

function updateStars(value) {
  document.querySelectorAll('#feedback-stars span').forEach(s => {
    s.classList.toggle('active', parseInt(s.dataset.value) <= value);
  });
}

async function submitFeedback() {
  if (!feedbackRating) {
    document.getElementById('feedback-status').textContent = 'Pilih rating bintang dulu.';
    return;
  }

  const submitBtn = document.getElementById('feedback-submit');
  submitBtn.disabled = true;
  document.getElementById('feedback-status').textContent = 'Mengirim...';

  const { data: { session } } = await db.auth.getSession();

  const { error } = await db.from('feedback').insert({
    user_id: session?.user?.id || null,
    rating: feedbackRating,
    message: document.getElementById('feedback-message').value.trim() || null,
    page: 'news'
  });

  if (error) {
    document.getElementById('feedback-status').textContent = 'Gagal mengirim. Coba lagi.';
    console.error('Feedback error:', JSON.stringify(error));
    submitBtn.disabled = false;
  } else {
    document.getElementById('feedback-status').innerHTML =
      '✓ Masukan kamu sudah kami terima. Terima kasih telah membantu Babelens menjadi lebih baik!';
    document.getElementById('feedback-submit').disabled = true;
    setTimeout(() => closeFeedback(null, true), 3000);
  }
}