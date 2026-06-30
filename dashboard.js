const db = window.db;

const CHART_COLORS = {
  pdrbRelevant: '#16a34a',
  pdrbNotRelevant: '#9ca3af',
  lapus: '#0d9488',
  wilayah: '#0d9488',
  status: {
    'Sudah Terjadi':   '#1d4ed8', // biru gelap — prioritas utama
    'Sedang Terjadi':  '#60a5fa', // biru sedang — prioritas kedua
    'Akan Terjadi':    '#bfdbfe', // biru muda — belum terkonfirmasi
    'Tidak Disebutkan':'#e2e8f0'  // abu sangat muda — tidak informatif
  },
  neutral: '#d1d5db'
};

let rawData = [];
let lastFilteredData = [];

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

// ====================================
// INIT
// ====================================
window.onload = async () => {
  const { data } = await db.from('news')
    .select('publication_datetime')
    .order('publication_datetime', { ascending: false })
    .limit(1);

  const defaultStartDate = '2026-01-01';
  let maxDate = defaultStartDate;
  let minDate = defaultStartDate;

  if (data && data.length > 0) {
    const latest = new Date(data[0].publication_datetime);
    maxDate = latest.toISOString().split('T')[0];
    if (new Date(maxDate) < new Date(defaultStartDate)) {
      minDate = maxDate;
    }
  } else {
    const today = new Date();
    maxDate = today.toISOString().split('T')[0];
  }

  const datasetMin = '2025-10-01';
  const dashFrom = document.getElementById('dash_from');
  const dashTo = document.getElementById('dash_to');
  dashFrom.value = minDate;
  dashFrom.min = datasetMin;
  dashTo.value = maxDate;

  document.getElementById('dash_region').addEventListener('change', applyFiltersAndRender);
  document.getElementById('dash_pdrb_only').addEventListener('change', applyFiltersAndRender);

  loadDashboard();
};

// ====================================
// LOAD DASHBOARD
// ====================================
async function loadDashboard() {
  const dateFrom = document.getElementById('dash_from').value;
  const dateTo = document.getElementById('dash_to').value;

  let query = db.from('news')
    .select('publication_datetime, lapus, region_final, pdrb_relevan, event_time');

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
  const region = document.getElementById('dash_region').value;
  const pdrbOnly = document.getElementById('dash_pdrb_only').checked;

  let filtered = rawData;
  if (region)   filtered = filtered.filter(r => r.region_final === region);
  if (pdrbOnly) filtered = filtered.filter(r => r.pdrb_relevan === 'YA');

  lastFilteredData = filtered;
  renderStats(filtered);
  renderTren(filtered);
  renderLapus(filtered);
  renderWilayah(filtered);
  renderPdrb(filtered);
  renderStatus(filtered);
}

// ====================================
// STAT CARDS
// ====================================
function renderStats(data) {
  const total = data.length;
  const pdrb = data.filter(r => r.pdrb_relevan === 'YA').length;
  const lapusSet = new Set(data.map(r => r.lapus).filter(Boolean));
  const wilayahSet = new Set(data.map(r => r.region_final).filter(Boolean));

  document.getElementById('stat-total').textContent = total.toLocaleString('id-ID');
  document.getElementById('stat-pdrb').textContent = pdrb.toLocaleString('id-ID');
  document.getElementById('stat-lapus').textContent = lapusSet.size;
  document.getElementById('stat-wilayah').textContent = wilayahSet.size;
}

// ====================================
// HELPERS
// ====================================
function countBy(data, key) {
  return data.reduce((acc, r) => {
    const val = r[key] || 'Tidak Diketahui';
    acc[val] = (acc[val] || 0) + 1;
    return acc;
  }, {});
}

function echartsColors() {
  return ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#65a30d'];
}

const fmt = n => n.toLocaleString('id-ID');

// ====================================
// CHART: JUMLAH PER BULAN
// ====================================
function renderTren(data) {
  const monthlyTotal = {};
  const monthlyRelevant = {};

  data.forEach(r => {
    if (!r.publication_datetime) return;
    const d = new Date(r.publication_datetime);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    monthlyTotal[key] = (monthlyTotal[key] || 0) + 1;
    if (r.pdrb_relevan === 'YA') {
      monthlyRelevant[key] = (monthlyRelevant[key] || 0) + 1;
    }
  });

  const BULAN_ID = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];

  const keys = Object.keys(monthlyTotal).sort();
  const indoLabels = keys.map(k => {
    const [year, month] = k.split('-');
    return `${BULAN_ID[parseInt(month, 10) - 1]}\n${year}`;
  });
  const relevantValues = keys.map(k => monthlyRelevant[k] || 0);
  const notRelevantValues = keys.map(k => (monthlyTotal[k] || 0) - (monthlyRelevant[k] || 0));

  const chart = echarts.init(document.getElementById('chart-tren'));
  chart.setOption({
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: params => params.map(p => `${p.marker}${p.seriesName}: <b>${fmt(p.value)}</b>`).join('<br/>')
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
        label: { show: true, position: 'insideTop', fontSize: 11, formatter: p => p.value === 0 ? '' : fmt(p.value) }
      },
      {
        name: 'Tidak Relevan',
        type: 'bar',
        stack: 'total',
        data: notRelevantValues,
        itemStyle: { color: CHART_COLORS.pdrbNotRelevant, borderRadius: [4, 4, 0, 0] },
        label: { show: true, position: 'insideTop', fontSize: 11, formatter: p => p.value === 0 ? '' : fmt(p.value) }
      }
    ],
    grid: { left: 10, right: 20, bottom: 30, top: 10 }
  });
  window.addEventListener('resize', () => chart.resize());
}

// ====================================
// CHART: LAPANGAN USAHA
// ====================================
function renderLapus(data) {
  const counts = countBy(data.filter(r => r.lapus), 'lapus');
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const chart = echarts.init(document.getElementById('chart-lapus'));
  chart.setOption({
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: p => {
        const code = p[0].name;
        const fullName = LAPUS_LABELS[code] || code;
        return `${fullName} (${code})<br/><b>${fmt(p[0].value)}</b>`;
      }
    },
    xAxis: { type: 'value', axisLabel: { show: false }, splitLine: { show: false } },
    yAxis: { type: 'category', data: sorted.map(x => x[0]).reverse() },
    series: [{
      type: 'bar',
      data: sorted.map(x => x[1]).reverse(),
      itemStyle: { color: CHART_COLORS.lapus, borderRadius: [0, 4, 4, 0] },
      label: { show: true, position: 'right', fontSize: 11, formatter: p => fmt(p.value) }
    }],
    grid: { left: 40, right: 60, bottom: 10, top: 10 }
  });
  window.addEventListener('resize', () => chart.resize());
}

// ====================================
// CHART: WILAYAH
// ====================================
function renderWilayah(data) {
  const counts = countBy(data.filter(r => r.region_final), 'region_final');
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);

  const chart = echarts.init(document.getElementById('chart-wilayah'));
  chart.setOption({
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: p => `${p[0].name}<br/><b>${fmt(p[0].value)}</b>`
    },
    xAxis: { type: 'value', axisLabel: { show: false }, splitLine: { show: false } },
    yAxis: { type: 'category', data: sorted.map(x => x[0]).reverse() },
    series: [{
      type: 'bar',
      data: sorted.map(x => x[1]).reverse(),
      itemStyle: { color: CHART_COLORS.wilayah, borderRadius: [0, 4, 4, 0] },
      label: { show: true, position: 'right', fontSize: 11, formatter: p => fmt(p.value) }
    }],
    grid: { left: 150, right: 60, bottom: 10, top: 10 }
  });
  window.addEventListener('resize', () => chart.resize());
}

// ====================================
// CHART: PDRB RELEVAN (DONUT)
// ====================================
function renderPdrb(data) {
  const ya = data.filter(r => r.pdrb_relevan === 'YA').length;
  const tidak = data.length - ya;
  const total = ya + tidak;
  const relevanPct = total > 0 ? ((ya / total) * 100).toFixed(2) + '%' : '0%';

  const el = document.getElementById('chart-pdrb');
  if (!el) { setTimeout(() => renderPdrb(data), 100); return; }

  el.style.position = 'relative';

  // Reuse existing instance to avoid re-stacking the canvas layer
  const chart = echarts.getInstanceByDom(el) || echarts.init(el);
  chart.setOption({
    tooltip: { trigger: 'item', formatter: p => `${p.name}: ${fmt(p.value)} (${p.percent}%)` },
    legend: { show: false },
    series: [{
      type: 'pie',
      radius: ['45%', '70%'],
      data: [
        { value: ya, name: 'Relevan', itemStyle: { color: CHART_COLORS.pdrbRelevant } },
        { value: tidak, name: 'Tidak Relevan', itemStyle: { color: CHART_COLORS.pdrbNotRelevant } }
      ],
      label: { show: false },
      labelLine: { show: false }
    }]
  });

  // Inject after setOption so the label sits above the ECharts canvas in z-order
  const injectLabel = () => {
    const prev = el.querySelector('.pdrb-html-label');
    if (prev) prev.remove();
    const label = document.createElement('div');
    label.className = 'pdrb-html-label';
    label.style.cssText = 'position:absolute;top:8px;right:8px;text-align:right;line-height:1.4;pointer-events:none;z-index:10;';
    label.innerHTML = `<span style="display:block;font-size:11px;font-weight:700;color:#10b981;">Relevan</span>`
                    + `<span style="display:block;font-size:11px;font-weight:700;color:#10b981;">${relevanPct}</span>`;
    el.appendChild(label);
  };
  injectLabel();

  window.addEventListener('resize', () => chart.resize());
}

// ====================================
// LAPUS MODAL
// ====================================
let lapusModalChart = null;

function openLapusModal() {
  const modal = document.getElementById('lapus-modal');
  modal.classList.add('open');

  const counts = countBy(lastFilteredData.filter(r => r.lapus), 'lapus');
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);

  const el = document.getElementById('chart-lapus-all');
  if (!lapusModalChart) {
    lapusModalChart = echarts.init(el);
  }
  lapusModalChart.setOption({
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: p => {
        const code = p[0].name;
        const fullName = LAPUS_LABELS[code] || code;
        return `${fullName} (${code})<br/><b>${fmt(p[0].value)}</b>`;
      }
    },
    xAxis: { type: 'value', axisLabel: { show: false }, splitLine: { show: false } },
    yAxis: { type: 'category', data: sorted.map(x => x[0]).reverse(), axisLabel: { fontSize: 12 } },
    series: [{
      type: 'bar',
      data: sorted.map(x => x[1]).reverse(),
      itemStyle: { color: CHART_COLORS.lapus, borderRadius: [0, 4, 4, 0] },
      label: { show: true, position: 'right', fontSize: 12, formatter: p => fmt(p.value) }
    }],
    grid: { left: 40, right: 60, bottom: 10, top: 10 }
  });
  lapusModalChart.resize();
}

function closeLapusModal(e) {
  if (e.target === document.getElementById('lapus-modal')) {
    document.getElementById('lapus-modal').classList.remove('open');
  }
}

function closeLapusModalDirect() {
  document.getElementById('lapus-modal').classList.remove('open');
}

// ====================================
// CHART: STATUS KEJADIAN (DONUT)
// ====================================
function renderStatus(data) {
  const counts = countBy(data.filter(r => r.event_time), 'event_time');
  const colors = CHART_COLORS.status;
  const ORDER = ['Sudah Terjadi', 'Sedang Terjadi', 'Akan Terjadi', 'Tidak Disebutkan'];
  const labels = ORDER.filter(k => counts[k] !== undefined);
  const values = labels.map(k => counts[k] || 0);
  const barColors = labels.map(k => colors[k] || CHART_COLORS.neutral);

  const chart = echarts.init(document.getElementById('chart-status'));
  chart.setOption({
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: p => `${p[0].name}<br/><b>${fmt(p[0].value)}</b>` },
    xAxis: { type: 'value', show: false, splitLine: { show: false } },
    yAxis: { type: 'category', data: labels },
    series: [{
      type: 'bar',
      data: values.map((v, i) => ({ value: v, itemStyle: { color: barColors[i] } })),
      label: { show: true, position: 'right', fontSize: 11, formatter: p => fmt(p.value) },
      itemStyle: { borderRadius: [0, 4, 4, 0] }
    }],
    grid: { left: 120, right: 50, bottom: 10, top: 10, containLabel: false }
  });
  window.addEventListener('resize', () => chart.resize());
}
