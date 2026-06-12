const SUPABASE_URL = 'https://cyqqohycenkoludiefgq.supabase.co';
const SUPABASE_KEY = 'sb_publishable_cuOUAfPmSs0ooVWrvbcISQ_VF5eOStv';
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  global: {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`
    }
  }
});

const CHART_COLORS = {
  pdrbRelevant: '#16a34a',
  pdrbNotRelevant: '#d97706',
  lapus: '#2563eb',
  wilayah: '#0891b2',
  pdrb: '#7c3aed',
  status: {
    'Sudah Terjadi': '#6b7280',
    'Sedang Terjadi': '#2563eb',
    'Akan Terjadi': '#d97706'
  },
  neutral: '#94a3b8'
};

// ====================================
// MOBILE SIDEBAR
// ====================================
const sidebar = document.getElementById("sidebar");
const overlay = document.getElementById("sidebarOverlay");
document.getElementById("mobileMenuBtn").addEventListener("click", () => {
  sidebar.classList.add("open");
  overlay.classList.add("show");
});
document.getElementById("closeSidebarBtn").addEventListener("click", closeSidebar);
overlay.addEventListener("click", closeSidebar);
function closeSidebar() {
  sidebar.classList.remove("open");
  overlay.classList.remove("show");
}

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

  document.getElementById('dash_from').value = minDate;
  document.getElementById('dash_to').value = maxDate;

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

  renderStats(data);
  renderTren(data);
  renderLapus(data);
  renderWilayah(data);
  renderPdrb(data);
  renderStatus(data);
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

// ====================================
// CHART: TREN PER BULAN
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

  const keys = Object.keys(monthlyTotal).sort();
  const relevantValues = keys.map(k => monthlyRelevant[k] || 0);
  const notRelevantValues = keys.map(k => (monthlyTotal[k] || 0) - (monthlyRelevant[k] || 0));

  const chart = echarts.init(document.getElementById('chart-tren'));
  chart.setOption({
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { bottom: 0 },
    xAxis: { type: 'category', data: keys, axisLabel: { rotate: 30 } },
    yAxis: { type: 'value', name: 'Jumlah Berita' },
    series: [
      {
        name: 'PDRB Relevan',
        type: 'bar',
        stack: 'total',
        data: relevantValues,
        itemStyle: { color: CHART_COLORS.pdrbRelevant, borderRadius: [4, 4, 0, 0] },
        label: { show: true, position: 'insideTop', fontSize: 11 }
      },
      {
        name: 'Tidak Relevan',
        type: 'bar',
        stack: 'total',
        data: notRelevantValues,
        itemStyle: { color: CHART_COLORS.pdrbNotRelevant, borderRadius: [4, 4, 0, 0] },
        label: { show: true, position: 'insideTop', fontSize: 11 }
      }
    ],
    grid: { left: 50, right: 20, bottom: 60, top: 30 }
  });
  window.addEventListener('resize', () => chart.resize());
}

// ====================================
// CHART: LAPANGAN USAHA
// ====================================
function renderLapus(data) {
  const counts = countBy(data.filter(r => r.lapus), 'lapus');
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);

  const chart = echarts.init(document.getElementById('chart-lapus'));
  chart.setOption({
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    xAxis: { type: 'value' },
    yAxis: { type: 'category', data: sorted.map(x => x[0]).reverse() },
    series: [{
      type: 'bar',
      data: sorted.map(x => x[1]).reverse(),
      itemStyle: { color: CHART_COLORS.lapus, borderRadius: [0, 4, 4, 0] },
      label: { show: true, position: 'right', fontSize: 11 }
    }],
    grid: { left: 40, right: 60, bottom: 20, top: 10 }
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
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    xAxis: { type: 'value' },
    yAxis: { type: 'category', data: sorted.map(x => x[0]).reverse() },
    series: [{
      type: 'bar',
      data: sorted.map(x => x[1]).reverse(),
      itemStyle: { color: CHART_COLORS.wilayah, borderRadius: [0, 4, 4, 0] },
      label: { show: true, position: 'right', fontSize: 11 }
    }],
    grid: { left: 120, right: 60, bottom: 20, top: 10 }
  });
  window.addEventListener('resize', () => chart.resize());
}

// ====================================
// CHART: PDRB RELEVAN (DONUT)
// ====================================
function renderPdrb(data) {
  const ya = data.filter(r => r.pdrb_relevan === 'YA').length;
  const tidak = data.length - ya;

  const chart = echarts.init(document.getElementById('chart-pdrb'));
  chart.setOption({
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    legend: { bottom: 0 },
    series: [{
      type: 'pie',
      radius: ['45%', '70%'],
      data: [
        { value: ya, name: 'Relevan', itemStyle: { color: CHART_COLORS.pdrbRelevant } },
        { value: tidak, name: 'Tidak Relevan', itemStyle: { color: CHART_COLORS.pdrbNotRelevant } }
      ],
      label: { formatter: '{b}\n{d}%' }
    }]
  });
  window.addEventListener('resize', () => chart.resize());
}

// ====================================
// CHART: STATUS KEJADIAN (DONUT)
// ====================================
function renderStatus(data) {
  const counts = countBy(data.filter(r => r.event_time), 'event_time');
  const colors = CHART_COLORS.status;

  const chart = echarts.init(document.getElementById('chart-status'));
  chart.setOption({
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    legend: { bottom: 0 },
    series: [{
      type: 'pie',
      radius: ['45%', '70%'],
      data: Object.entries(counts).map(([name, value]) => ({
        name, value, itemStyle: { color: colors[name] || '#94a3b8' }
      })),
      label: { formatter: '{b}\n{d}%' }
    }]
  });
  window.addEventListener('resize', () => chart.resize());
}
