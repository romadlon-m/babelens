const db = window.db;

// LABEL_CUTOFF: tanggal artikel terlabeli terbaru (batch 1, ~22k artikel).
// Artikel setelahnya belum punya lu_relevan/pengeluaran_relevan.
// Update setelah batch labeling berikutnya selesai diupload ke Supabase.
// Terakhir diupdate: 2 Agustus 2026.
const LABEL_CUTOFF  = '2026-07-18';
const DATASET_START = '2025-10-01'; // tanggal data paling awal di Supabase

const CHART_COLORS = {
  pdrbRelevant:    '#16a34a',
  pdrbNotRelevant: '#9ca3af',
  lapus:           '#6366f1',   // indigo — sektor produksi/lapangan usaha
  pengeluaran:     '#d97706',   // amber  — sisi pengeluaran/konsumsi
  wilayah:         '#0d9488',   // teal   — geografis
  status: {
    'Sudah Terjadi':    '#1d4ed8',
    'Sedang Terjadi':   '#60a5fa',
    'Akan Terjadi':     '#bfdbfe',
    'Tidak Disebutkan': '#e2e8f0'
  },
  neutral: '#d1d5db'
};

let rawData = [];
let lastFilteredData = [];

// ====================================
// LABEL MAPS
// ====================================
const LAPUS_LABELS = {
  A:    'Pertanian, Kehutanan, dan Perikanan',
  B:    'Pertambangan dan Penggalian',
  C:    'Industri Pengolahan',
  D:    'Pengadaan Listrik dan Gas',
  E:    'Pengadaan Air, Pengelolaan Sampah, Limbah dan Daur Ulang',
  F:    'Konstruksi',
  G:    'Perdagangan Besar dan Eceran; Reparasi Mobil dan Sepeda Motor',
  H:    'Transportasi dan Pergudangan',
  I:    'Penyediaan Akomodasi dan Makan Minum',
  J:    'Informasi dan Komunikasi',
  K:    'Jasa Keuangan dan Asuransi',
  L:    'Real Estat',
  MN:   'Jasa Perusahaan',
  O:    'Administrasi Pemerintahan, Pertahanan dan Jaminan Sosial Wajib',
  P:    'Jasa Pendidikan',
  Q:    'Jasa Kesehatan dan Kegiatan Sosial',
  RSTU: 'Jasa Lainnya'
};

const LAPUS_SHORT_LABELS = {
  A:    'Pertanian & Perikanan',
  B:    'Pertambangan',
  C:    'Industri Pengolahan',
  D:    'Listrik & Gas',
  E:    'Air & Limbah',
  F:    'Konstruksi',
  G:    'Perdagangan & Reparasi',
  H:    'Transportasi',
  I:    'Akomodasi & Kuliner',
  J:    'Informasi & Komunikasi',
  K:    'Jasa Keuangan',
  L:    'Real Estat',
  MN:   'Jasa Perusahaan',
  O:    'Adm. Pemerintahan',
  P:    'Jasa Pendidikan',
  Q:    'Jasa Kesehatan',
  RSTU: 'Jasa Lainnya'
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

const PENGELUARAN_SHORT_LABELS = {
  '1a': 'Makanan & Minuman',
  '1b': 'Alkohol & Rokok',
  '1c': 'Pakaian',
  '1d': 'Perumahan & Energi',
  '1e': 'Perabot RT',
  '1f': 'Kesehatan',
  '1g': 'Transportasi',
  '1h': 'Komunikasi',
  '1i': 'Rekreasi & Budaya',
  '1j': 'Pendidikan',
  '1k': 'Hotel & Penginapan',
  '1l': 'Barang Pribadi',
  '1':  'Konsumsi RT',
  '2':  'Konsumsi LNPRT',
  '3':  'Konsumsi Pemerintah',
  '4':  'PMTB',
  '5':  'Perubahan Inventori',
  '6':  'Ekspor LN',
  '7':  'Impor LN'
};

// ====================================
// HELPERS
// ====================================
function isPdrbRelevan(r) {
  return r.lu_relevan === 'Ya' || r.pengeluaran_relevan === 'Ya';
}

function countByLapus(data) {
  return data.reduce((acc, r) => {
    (r.kategori_lapus || []).forEach(v => { acc[v] = (acc[v] || 0) + 1; });
    return acc;
  }, {});
}

function countByPengeluaran(data) {
  return data.reduce((acc, r) => {
    (r.komponen_pengeluaran || []).forEach(v => { acc[v] = (acc[v] || 0) + 1; });
    return acc;
  }, {});
}

function countBy(data, key) {
  return data.reduce((acc, r) => {
    const val = r[key] || 'Tidak Diketahui';
    acc[val] = (acc[val] || 0) + 1;
    return acc;
  }, {});
}

const fmt = n => n.toLocaleString('id-ID');

// ====================================
// INIT
// ====================================
window.onload = async () => {
  // LABEL_CUTOFF dan DATASET_START didefinisikan sebagai konstanta global di atas.
  // Update LABEL_CUTOFF setelah batch pelabelan berikutnya selesai diupload ke Supabase.
  // Terakhir diupdate: 2 Agustus 2026 (pelabelan batch 1, ~22k artikel).

  document.getElementById('dash_from').value = `${new Date().getFullYear()}-01-01`;
  document.getElementById('dash_from').min   = DATASET_START;
  document.getElementById('dash_to').value   = LABEL_CUTOFF;

  document.getElementById('dash_region').addEventListener('change', applyFiltersAndRender);
  document.getElementById('dash_pdrb_only').addEventListener('change', applyFiltersAndRender);
  document.getElementById('dash_preset').addEventListener('change', applyPreset);

  buildPresetOptions();
  loadRunningText();
  loadDashboard();
};

// ====================================
// RUNNING TEXT
// ====================================
async function loadRunningText() {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);

  const KEYWORDS = [
    'timah', 'lada', 'kaolin', 'sawit', 'ekspor', 'investasi',
    'ekonomi', 'pariwisata', 'inflasi', 'umkm', 'tambang', 'perikanan'
  ];

  // Prioritas 1: artikel PDRB relevan (hari ini & kemarin)
  let { data } = await db.from('news')
    .select('title, url')
    .gte('publication_datetime', yesterdayStr)
    .or('lu_relevan.eq.Ya,pengeluaran_relevan.eq.Ya')
    .order('publication_datetime', { ascending: false })
    .limit(10);

  // Fallback: filter keyword strategis pada judul
  if (!data || data.length === 0) {
    const kwFilter = KEYWORDS.map(k => `title.ilike.%${k}%`).join(',');
    ({ data } = await db.from('news')
      .select('title, url')
      .gte('publication_datetime', yesterdayStr)
      .or(kwFilter)
      .order('publication_datetime', { ascending: false })
      .limit(10));
  }

  const bar   = document.getElementById('running-text-bar');
  const inner = document.getElementById('running-text-inner');

  if (!data || data.length === 0) {
    bar.style.display = 'none';
    return;
  }

  const sep      = '<span class="running-text-sep">·</span>';
  const itemsHtml = data
    .map(item => `<a class="running-text-item" href="${item.url}" target="_blank" rel="noopener">${item.title}</a>`)
    .join(sep);

  // Duplikat untuk seamless loop (animasi geser -50%)
  inner.innerHTML = itemsHtml + sep + itemsHtml;

  // Kecepatan berdasarkan panjang total karakter judul
  const totalChars = data.reduce((sum, item) => sum + item.title.length, 0);
  const duration   = Math.max(60, Math.round(totalChars * 0.35));
  inner.style.animationDuration = `${duration}s`;

  bar.style.display = 'flex';
}

// ====================================
// PRESET PERIODE
// ====================================
const BULAN_NAMA = [
  'Januari','Februari','Maret','April','Mei','Juni',
  'Juli','Agustus','September','Oktober','November','Desember'
];

function buildPresetOptions() {
  const now        = new Date();
  const thisYear   = now.getFullYear();
  const thisMonth  = now.getMonth(); // 0-indexed

  // ── Triwulan ──────────────────────────────────────────
  const groupTw = document.getElementById('preset-group-tw');
  const quarters = [
    { label: `Triwulan I ${thisYear}  (Jan–Mar)`,  from: `${thisYear}-01-01`, to: `${thisYear}-03-31`, endMonth: 2  },
    { label: `Triwulan II ${thisYear} (Apr–Jun)`,  from: `${thisYear}-04-01`, to: `${thisYear}-06-30`, endMonth: 5  },
    { label: `Triwulan III ${thisYear} (Jul–Sep)`, from: `${thisYear}-07-01`, to: `${thisYear}-09-30`, endMonth: 8  },
    { label: `Triwulan IV ${thisYear} (Okt–Des)`,  from: `${thisYear}-10-01`, to: `${thisYear}-12-31`, endMonth: 11 }
  ];

  quarters.forEach(q => {
    const opt     = document.createElement('option');
    opt.value     = `tw|${q.from}|${q.to}`;
    opt.textContent = q.label;
    // Disable triwulan yang belum dimulai
    if (thisMonth < q.endMonth - 2) opt.disabled = true;
    groupTw.appendChild(opt);
  });

  // ── Bulanan ───────────────────────────────────────────
  const groupBln = document.getElementById('preset-group-bln');
  // Tampilkan bulan dari Januari tahun ini sampai bulan ini
  for (let m = 0; m <= thisMonth; m++) {
    const opt       = document.createElement('option');
    const mm        = String(m + 1).padStart(2, '0');
    const lastDay   = new Date(thisYear, m + 1, 0).getDate();
    opt.value       = `bln|${thisYear}-${mm}-01|${thisYear}-${mm}-${lastDay}`;
    opt.textContent = `${BULAN_NAMA[m]} ${thisYear}`;
    groupBln.appendChild(opt);
  }
}

function applyPreset() {
  const val      = document.getElementById('dash_preset').value;
  const dashFrom = document.getElementById('dash_from');
  const dashTo   = document.getElementById('dash_to');

  if (!val) return;

  const now      = new Date();
  const thisYear = now.getFullYear();

  if (val === 'year') {
    dashFrom.value = `${thisYear}-01-01`;
    dashTo.value   = LABEL_CUTOFF;
  } else if (val === 'all') {
    dashFrom.value = DATASET_START;
    dashTo.value   = LABEL_CUTOFF;
  } else {
    // format: "tw|from|to" atau "bln|from|to"
    const [, from, to] = val.split('|');
    dashFrom.value = from;
    // Batasi tanggal akhir ke LABEL_CUTOFF jika periode melewatinya
    dashTo.value   = to > LABEL_CUTOFF ? LABEL_CUTOFF : to;
  }

  loadDashboard();
}

// ====================================
// LOAD DASHBOARD
// ====================================
async function loadDashboard() {
  const dateFrom = document.getElementById('dash_from').value;
  const dateTo   = document.getElementById('dash_to').value;

  let query = db.from('news')
    .select('publication_datetime, kategori_lapus, komponen_pengeluaran, region_final, lu_relevan, pengeluaran_relevan, event_time');

  if (dateFrom) query = query.gte('publication_datetime', dateFrom);
  if (dateTo)   query = query.lte('publication_datetime', dateTo + 'T23:59:59');

  const { data, error } = await query;
  if (error || !data) return;

  rawData = data;
  applyFiltersAndRender();
}

// ====================================
// APPLY FILTERS + RENDER
// ====================================
function applyFiltersAndRender() {
  const region  = document.getElementById('dash_region').value;
  const pdrbOnly = document.getElementById('dash_pdrb_only').checked;

  let filtered = rawData;
  if (region)   filtered = filtered.filter(r => r.region_final === region);
  if (pdrbOnly) filtered = filtered.filter(r => isPdrbRelevan(r));

  lastFilteredData = filtered;

  updateWilayahVisibility(region);
  renderStats(filtered);
  renderTren(filtered);
  renderLapus(filtered);
  renderPengeluaran(filtered);
  renderWilayah(filtered);
  renderStatus(filtered);
}

// ====================================
// WILAYAH VISIBILITY
// ====================================
function updateWilayahVisibility(region) {
  const wrapWilayah = document.getElementById('wrap-wilayah');
  const wrapTren    = document.getElementById('wrap-tren');

  if (region) {
    // Region spesifik: sembunyikan chart wilayah, tren melebar
    wrapWilayah.classList.add('hidden');
    wrapTren.classList.add('tren-expanded');
  } else {
    wrapWilayah.classList.remove('hidden');
    wrapTren.classList.remove('tren-expanded');
  }

  // Resize chart tren setelah layout berubah
  setTimeout(() => {
    echarts.getInstanceByDom(document.getElementById('chart-tren'))?.resize();
    echarts.getInstanceByDom(document.getElementById('chart-wilayah'))?.resize();
  }, 60);
}

// ====================================
// STAT CARDS
// ====================================
function renderStats(data) {
  const total      = data.length;
  const pdrb       = data.filter(r => isPdrbRelevan(r)).length;
  const luRelevan  = data.filter(r => r.lu_relevan === 'Ya').length;
  const pengRelevan = data.filter(r => r.pengeluaran_relevan === 'Ya').length;
  const lapusSet   = new Set(data.flatMap(r => r.kategori_lapus || []));
  const wilayahSet = new Set(data.map(r => r.region_final).filter(Boolean));

  document.getElementById('stat-total').textContent   = total.toLocaleString('id-ID');
  document.getElementById('stat-pdrb').textContent    = pdrb.toLocaleString('id-ID');
  document.getElementById('stat-lapus').textContent   = lapusSet.size;
  document.getElementById('stat-wilayah').textContent = wilayahSet.size;

  const infoEl = document.getElementById('stat-pdrb-info');
  if (infoEl) {
    infoEl.dataset.tooltip =
      `Lapangan Usaha: ${luRelevan.toLocaleString('id-ID')} artikel — `
      + `Pengeluaran: ${pengRelevan.toLocaleString('id-ID')} artikel — `
      + `Total PDRB Relevan tidak sama dengan penjumlahan keduanya karena satu artikel dapat relevan di keduanya sekaligus. `
      + `Relevansi mencakup keterkaitan langsung maupun tidak langsung dengan PDRB.`;
  }
}

// ====================================
// CHART: JUMLAH BERITA PER BULAN
// ====================================
function renderTren(data) {
  const monthlyTotal    = {};
  const monthlyRelevant = {};

  data.forEach(r => {
    if (!r.publication_datetime) return;
    const d   = new Date(r.publication_datetime);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    monthlyTotal[key] = (monthlyTotal[key] || 0) + 1;
    if (isPdrbRelevan(r)) monthlyRelevant[key] = (monthlyRelevant[key] || 0) + 1;
  });

  const BULAN_ID = ['Januari','Februari','Maret','April','Mei','Juni',
                    'Juli','Agustus','September','Oktober','November','Desember'];

  const keys           = Object.keys(monthlyTotal).sort();
  const indoLabels     = keys.map(k => {
    const [year, month] = k.split('-');
    return `${BULAN_ID[parseInt(month, 10) - 1]}\n${year}`;
  });
  const relevantValues    = keys.map(k => monthlyRelevant[k] || 0);
  const notRelevantValues = keys.map(k => (monthlyTotal[k] || 0) - (monthlyRelevant[k] || 0));
  const totalValues       = keys.map(k => monthlyTotal[k] || 0);

  const maxTotal     = Math.max(...totalValues, 1);
  const minLabelValue = maxTotal * 0.05;

  const el    = document.getElementById('chart-tren');
  const chart = echarts.getInstanceByDom(el) || echarts.init(el);
  chart.setOption({
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: params => {
        const idx  = params[0].dataIndex;
        const rel  = relevantValues[idx];
        const tot  = totalValues[idx];
        const pct  = tot > 0 ? ((rel / tot) * 100).toFixed(1) : '0';
        const label = indoLabels[idx].replace('\n', ' ');
        return `<b>${label}</b><br/>`
          + `Relevan: <b>${fmt(rel)}</b> (${pct}%)<br/>`
          + `Tidak: <b>${fmt(notRelevantValues[idx])}</b><br/>`
          + `Total: <b>${fmt(tot)}</b>`;
      }
    },
    legend: { show: false },
    xAxis: { type: 'category', data: indoLabels, axisLabel: { fontSize: 11, interval: 0 } },
    yAxis: { type: 'value', axisLabel: { show: false }, splitLine: { show: false } },
    series: [
      {
        name: 'PDRB Relevan',
        type: 'bar',
        stack: 'total',
        data: relevantValues,
        itemStyle: { color: CHART_COLORS.pdrbRelevant, borderRadius: [4, 4, 0, 0] },
        label: {
          show: true,
          position: 'insideTop',
          fontSize: 11,
          formatter: p => (p.value === 0 || p.value < minLabelValue) ? '' : fmt(p.value)
        }
      },
      {
        name: 'Tidak Relevan',
        type: 'bar',
        stack: 'total',
        data: notRelevantValues,
        itemStyle: { color: CHART_COLORS.pdrbNotRelevant, borderRadius: [4, 4, 0, 0] },
        label: { show: false }
      },
      {
        // Invisible series hanya untuk menampilkan total label di atas bar
        name: 'Total',
        type: 'bar',
        stack: 'total',
        data: totalValues.map(() => 0),
        itemStyle: { color: 'transparent' },
        tooltip: { show: false },
        label: {
          show: true,
          position: 'top',
          fontSize: 10,
          color: '#9ca3af',
          formatter: p => fmt(totalValues[p.dataIndex])
        }
      }
    ],
    grid: { left: 10, right: 20, bottom: 30, top: 24 }
  });
  window.addEventListener('resize', () => chart.resize());
}

// ====================================
// CHART: LAPANGAN USAHA (TOP 5)
// ====================================
function renderLapus(data) {
  const counts = countByLapus(data);
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const el    = document.getElementById('chart-lapus');
  const chart = echarts.getInstanceByDom(el) || echarts.init(el);

  const labelRatio = 0.45;
  const labelWidth = Math.round(chart.getWidth() * labelRatio) - 10;

  chart.setOption({
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: p => {
        const code = p[0].name;
        return `${LAPUS_LABELS[code] || code} (${code})<br/><b>${fmt(p[0].value)}</b>`;
      }
    },
    xAxis: { type: 'value', axisLabel: { show: false }, splitLine: { show: false } },
    yAxis: {
      type: 'category',
      data: sorted.map(x => x[0]).reverse(),
      axisLabel: {
        formatter: code => `${code} · ${LAPUS_SHORT_LABELS[code] || code}`,
        fontSize: 11,
        width: labelWidth,
        overflow: 'truncate',
        ellipsis: '...'
      }
    },
    series: [{
      type: 'bar',
      data: sorted.map(x => x[1]).reverse(),
      itemStyle: { color: CHART_COLORS.lapus, borderRadius: [0, 4, 4, 0] },
      label: { show: true, position: 'right', fontSize: 11, formatter: p => fmt(p.value) }
    }],
    grid: { left: `${Math.round(labelRatio * 100)}%`, right: 60, bottom: 10, top: 10 }
  });
  window.addEventListener('resize', () => chart.resize());
}

// ====================================
// CHART: KOMPONEN PENGELUARAN (TOP 5)
// ====================================
function renderPengeluaran(data) {
  const counts = countByPengeluaran(data);
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const el    = document.getElementById('chart-pengeluaran');
  const chart = echarts.getInstanceByDom(el) || echarts.init(el);

  const labelRatio = 0.45;
  const labelWidth = Math.round(chart.getWidth() * labelRatio) - 10;

  chart.setOption({
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: p => {
        const code = p[0].name;
        return `${PENGELUARAN_LABELS[code] || code} (${code})<br/><b>${fmt(p[0].value)}</b>`;
      }
    },
    xAxis: { type: 'value', axisLabel: { show: false }, splitLine: { show: false } },
    yAxis: {
      type: 'category',
      data: sorted.map(x => x[0]).reverse(),
      axisLabel: {
        formatter: code => `${code} · ${PENGELUARAN_SHORT_LABELS[code] || code}`,
        fontSize: 11,
        width: labelWidth,
        overflow: 'truncate',
        ellipsis: '...'
      }
    },
    series: [{
      type: 'bar',
      data: sorted.map(x => x[1]).reverse(),
      itemStyle: { color: CHART_COLORS.pengeluaran, borderRadius: [0, 4, 4, 0] },
      label: { show: true, position: 'right', fontSize: 11, formatter: p => fmt(p.value) }
    }],
    grid: { left: `${Math.round(labelRatio * 100)}%`, right: 60, bottom: 10, top: 10 }
  });
  window.addEventListener('resize', () => chart.resize());
}

// ====================================
// CHART: DISTRIBUSI WILAYAH
// ====================================
function renderWilayah(data) {
  const counts = countBy(data.filter(r => r.region_final), 'region_final');
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);

  const el    = document.getElementById('chart-wilayah');
  const chart = echarts.getInstanceByDom(el) || echarts.init(el);

  const wilayahLabelRatio = 0.42;
  const wilayahLabelWidth = Math.round(chart.getWidth() * wilayahLabelRatio) - 10;

  chart.setOption({
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: p => `${p[0].name}<br/><b>${fmt(p[0].value)}</b>`
    },
    xAxis: { type: 'value', axisLabel: { show: false }, splitLine: { show: false } },
    yAxis: {
      type: 'category',
      data: sorted.map(x => x[0]).reverse(),
      axisLabel: {
        fontSize: 10,
        width: wilayahLabelWidth,
        overflow: 'truncate',
        ellipsis: '...'
      }
    },
    series: [{
      type: 'bar',
      data: sorted.map(x => x[1]).reverse(),
      itemStyle: { color: CHART_COLORS.wilayah, borderRadius: [0, 4, 4, 0] },
      label: { show: true, position: 'right', fontSize: 10, formatter: p => fmt(p.value) }
    }],
    grid: { left: `${Math.round(wilayahLabelRatio * 100)}%`, right: 55, bottom: 10, top: 10 }
  });
  window.addEventListener('resize', () => chart.resize());
}

// ====================================
// CHART: STATUS KEJADIAN
// ====================================
function renderStatus(data) {
  const counts    = countBy(data.filter(r => r.event_time), 'event_time');
  const colors    = CHART_COLORS.status;
  const ORDER     = ['Sudah Terjadi', 'Sedang Terjadi', 'Akan Terjadi', 'Tidak Disebutkan'];
  const labels    = ORDER.filter(k => counts[k] !== undefined);
  const values    = labels.map(k => counts[k] || 0);
  const barColors = labels.map(k => colors[k] || CHART_COLORS.neutral);

  const el    = document.getElementById('chart-status');
  const chart = echarts.getInstanceByDom(el) || echarts.init(el);
  chart.setOption({
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: p => `${p[0].name}<br/><b>${fmt(p[0].value)}</b>`
    },
    xAxis: { type: 'value', show: false, splitLine: { show: false } },
    yAxis: {
      type: 'category',
      data: labels.map(l => l.replace(' ', '\n')),
      axisLabel: { fontSize: 11, lineHeight: 16 }
    },
    series: [{
      type: 'bar',
      data: values.map((v, i) => ({ value: v, itemStyle: { color: barColors[i] } })),
      label: { show: true, position: 'right', fontSize: 11, formatter: p => fmt(p.value) },
      itemStyle: { borderRadius: [0, 4, 4, 0] }
    }],
    grid: { left: 68, right: 50, bottom: 10, top: 10, containLabel: false }
  });
  window.addEventListener('resize', () => chart.resize());
}

// ====================================
// LAPUS MODAL
// ====================================
let lapusModalChart = null;

function openLapusModal() {
  document.getElementById('lapus-modal').classList.add('open');

  const counts = countByLapus(lastFilteredData);
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);

  const el = document.getElementById('chart-lapus-all');
  if (!lapusModalChart) lapusModalChart = echarts.init(el);

  // Tinggi dinamis: 36px per bar, minimum 300px
  el.style.height = Math.max(300, sorted.length * 36) + 'px';

  const labelRatio = 0.4;
  const labelWidth = Math.round(lapusModalChart.getWidth() * labelRatio) - 10;

  lapusModalChart.setOption({
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: p => {
        const code = p[0].name;
        return `${LAPUS_LABELS[code] || code} (${code})<br/><b>${fmt(p[0].value)}</b>`;
      }
    },
    xAxis: { type: 'value', axisLabel: { show: false }, splitLine: { show: false } },
    yAxis: {
      type: 'category',
      data: sorted.map(x => x[0]).reverse(),
      axisLabel: {
        fontSize: 12,
        formatter: code => `${code} · ${LAPUS_SHORT_LABELS[code] || code}`,
        overflow: 'truncate',
        ellipsis: '...',
        width: 160
      }
    },
    series: [{
      type: 'bar',
      data: sorted.map(x => x[1]).reverse(),
      itemStyle: { color: CHART_COLORS.lapus, borderRadius: [0, 4, 4, 0] },
      label: { show: true, position: 'right', fontSize: 12, formatter: p => fmt(p.value) }
    }],
    grid: { left: 8, right: 60, bottom: 10, top: 10, containLabel: true }
  });
  requestAnimationFrame(() => lapusModalChart.resize());
}

function closeLapusModal(e) {
  if (e.target === document.getElementById('lapus-modal'))
    document.getElementById('lapus-modal').classList.remove('open');
}

function closeLapusModalDirect() {
  document.getElementById('lapus-modal').classList.remove('open');
}

// ====================================
// PENGELUARAN MODAL
// ====================================
let pengModalChart = null;

function openPengModal() {
  document.getElementById('peng-modal').classList.add('open');

  const counts = countByPengeluaran(lastFilteredData);
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);

  const el = document.getElementById('chart-peng-all');
  if (!pengModalChart) pengModalChart = echarts.init(el);

  // Tinggi dinamis: 36px per bar, minimum 300px
  el.style.height = Math.max(300, sorted.length * 36) + 'px';

  const labelRatio = 0.4;
  const labelWidth = Math.round(pengModalChart.getWidth() * labelRatio) - 10;

  pengModalChart.setOption({
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: p => {
        const code = p[0].name;
        return `${PENGELUARAN_LABELS[code] || code} (${code})<br/><b>${fmt(p[0].value)}</b>`;
      }
    },
    xAxis: { type: 'value', axisLabel: { show: false }, splitLine: { show: false } },
    yAxis: {
      type: 'category',
      data: sorted.map(x => x[0]).reverse(),
      axisLabel: {
        fontSize: 12,
        formatter: code => `${code} · ${PENGELUARAN_SHORT_LABELS[code] || code}`,
        overflow: 'truncate',
        ellipsis: '...',
        width: 160
      }
    },
    series: [{
      type: 'bar',
      data: sorted.map(x => x[1]).reverse(),
      itemStyle: { color: CHART_COLORS.pengeluaran, borderRadius: [0, 4, 4, 0] },
      label: { show: true, position: 'right', fontSize: 12, formatter: p => fmt(p.value) }
    }],
    grid: { left: 8, right: 60, bottom: 10, top: 10, containLabel: true }
  });
  requestAnimationFrame(() => pengModalChart.resize());
}

function closePengModal(e) {
  if (e.target === document.getElementById('peng-modal'))
    document.getElementById('peng-modal').classList.remove('open');
}

function closePengModalDirect() {
  document.getElementById('peng-modal').classList.remove('open');
}