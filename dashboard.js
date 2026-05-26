const SUPABASE_URL = 'https://cyqqohycenkoludiefgq.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN5cXFvaHljZW5rb2x1ZGllZmdxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3NTE2NjYsImV4cCI6MjA5NTMyNzY2Nn0.J8gFaUhXjI_jgEtOvOMa9VtdmKm3TdLyNLHgsJsBrwM';
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  global: {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`
    }
  }
});

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
  const monthly = {};
  data.forEach(r => {
    if (!r.publication_datetime) return;
    const d = new Date(r.publication_datetime);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    monthly[key] = (monthly[key] || 0) + 1;
  });

  const keys = Object.keys(monthly).sort();
  const values = keys.map(k => monthly[k]);

  const chart = echarts.init(document.getElementById('chart-tren'));
  chart.setOption({
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: keys, axisLabel: { rotate: 30 } },
    yAxis: { type: 'value', name: 'Jumlah Berita' },
    series: [{
      type: 'bar',
      data: values,
      itemStyle: { color: '#2563eb', borderRadius: [4, 4, 0, 0] },
      label: { show: true, position: 'top', fontSize: 11 }
    }],
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
      itemStyle: { color: '#2563eb', borderRadius: [0, 4, 4, 0] },
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
      itemStyle: { color: '#16a34a', borderRadius: [0, 4, 4, 0] },
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
        { value: ya, name: 'Relevan', itemStyle: { color: '#16a34a' } },
        { value: tidak, name: 'Tidak Relevan', itemStyle: { color: '#e5e7eb' } }
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
  const colors = { 'Sudah Terjadi': '#6b7280', 'Sedang Terjadi': '#2563eb', 'Akan Terjadi': '#d97706' };

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