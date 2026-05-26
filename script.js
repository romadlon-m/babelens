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


// ====================================
// GLOBAL STATE
// ====================================
let lastParams = {};
let currentRows = [];
const CLIENT_PAGE_SIZE = 10;

// Defaults populated on first load from the DB
let defaultMinDate = null;
let defaultMaxDate = null;


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
// CARI
// ====================================
function search(page = 1) {

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

  result.innerHTML = `<div class="news-card">Memuat...</div>`;

  let query = db.from('news')
    .select('*')
    .order('publication_datetime', { ascending: false })
    .limit(100000);

  if (lastParams.region)       query = query.eq('region_final', lastParams.region);
  if (lastParams.lapus)        query = query.eq('lapus', lastParams.lapus);
  if (lastParams.pdrb_relevan) query = query.eq('pdrb_relevan', 'YA');
  if (lastParams.date_from)    query = query.gte('publication_datetime', lastParams.date_from);
  if (lastParams.date_to)      query = query.lte('publication_datetime', lastParams.date_to + 'T23:59:59');

  // Filter status kejadian
  const eventTimes = lastParams.event_time ? lastParams.event_time.split(',') : [];
  if (eventTimes.length > 0 && eventTimes.length < 3) {
    query = query.in('event_time', eventTimes);
  }

  query.then(({ data: rows, error }) => {
    if (error) {
      console.error(error);
      result.innerHTML = `<div class="news-card">Gagal memuat data.</div>`;
      return;
    }
    let filtered = rows || [];
    if (lastParams.keyword) {
      const kw = lastParams.keyword.toLowerCase();
      filtered = rows.filter(r =>
        (lastParams.f_title   && r.title?.toLowerCase().includes(kw)) ||
        (lastParams.f_summary && r.summary?.toLowerCase().includes(kw)) ||
        (lastParams.f_full    && r.content?.toLowerCase().includes(kw))
      );
    }
    currentRows = filtered;
    renderPage(1);
  });
}


// ====================================
// TAMPILKAN HALAMAN
// ====================================
function renderPage(page = 1) {

  const totalFound = currentRows.length;
  const totalPages = Math.max(1, Math.ceil(totalFound / CLIENT_PAGE_SIZE));
  const start = (page - 1) * CLIENT_PAGE_SIZE;
  const end = start + CLIENT_PAGE_SIZE;
  const rows = currentRows.slice(start, end);

  const showingStart = totalFound === 0 ? 0 : start + 1;
  const showingEnd = start + rows.length;

  // meta.innerHTML = `
  //   Ditemukan <b>${totalFound}</b> artikel • Halaman <b>${page}</b> dari <b>${totalPages}</b>
  //   <br>
  //   Menampilkan <b>${showingStart}</b> - <b>${showingEnd}</b>
  // `;

  meta.innerHTML = `
    Ditemukan <b>${totalFound}</b> artikel • Halaman <b>${page}</b> dari <b>${totalPages}</b> • Menampilkan <b>${showingStart}</b>–<b>${showingEnd}</b>
  `;

  if (!rows.length) {
    result.innerHTML = `<div class="news-card">Tidak ada hasil ditemukan.</div>`;
    pager.innerHTML = "";
    return;
  }

  let html = "";

  rows.forEach((r) => {

    const formattedDate = formatDateIndo(r.publication_datetime);
    const citationText = `${r.title} (${r.source}, ${formattedDate})`;
    const summaryText = `${r.title}\n${r.summary}`;
    const lapusTooltip = LAPUS_LABELS[r.lapus] || r.lapus || "-";

    html += `
      <article class="news-card">

        <div class="news-header">
          <div>
            <h3 class="news-title">
              <a href="${r.url}" target="_blank">
                ${r.title}
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
          ${r.summary || "-"}
          <span
            class="tooltip info-icon"
            data-tooltip="Ringkasan dibuat menggunakan AI. Harap verifikasi jika diperlukan."
          >
            i
          </span>
        </div>

        <div class="badges">

          <span
            class="badge tooltip ${r.pdrb_relevan === "YA" ? "badge-green" : "badge-gray"}"
            data-tooltip="Relevansi PDRB dibuat menggunakan klasifikasi AI. Harap verifikasi jika diperlukan."
          >
            PDRB: ${r.pdrb_relevan || "TIDAK"}
          </span>

          ${r.lapus ? `
            <span
              class="badge badge-blue tooltip"
              data-tooltip="${lapusTooltip} — Dibuat menggunakan model Machine Learning terlatih."
            >
              Lapus: ${r.lapus}
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
          >
            Artikel Lengkap
          </button>

        </div>

        <div class="full-article">${r.content || "-"}</div>

      </article>
    `;
  });

  result.innerHTML = html;
  renderPager(page, totalPages);
  window.scrollTo({ top: 0, behavior: "smooth" });
}


// ====================================
// NAVIGASI HALAMAN
// ====================================
function renderPager(page, totalPages) {

  let html = "";

  if (page > 1) {
    html += `<button onclick="renderPage(1)">Pertama</button>`;
    html += `<button onclick="renderPage(${page - 1})">Sebelumnya</button>`;
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
    html += `<button onclick="renderPage(${page + 1})">Berikutnya</button>`;
    html += `<button onclick="renderPage(${totalPages})">Terakhir</button>`;
  }

  pager.innerHTML = html;
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
}


// ====================================
// RESET
// ====================================
function resetSearch() {

  keyword.value = "";
  region.value = "";
  lapus.value = "";
  pdrb_only.checked = true;
  f_title.checked = true;
  f_summary.checked = true;
  f_full.checked = false;

  document.querySelectorAll(".event_filter").forEach(cb => cb.checked = true);

  const datasetMin = "2025-10-01";
  const maxD = defaultMaxDate || new Date().toISOString().split('T')[0];
  const minD = (() => {
    const d = new Date(maxD);
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  })();

  date_from.value = minD;
  date_to.value = maxD;
  date_from.min = datasetMin;
  date_to.min = date_from.value || datasetMin;
  date_from.max = maxD;
  date_to.max = maxD;

  search(1);
}


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
// EVENT OTOMATIS PENCARIAN
// ====================================
["region", "lapus", "date_from", "date_to", "pdrb_only", "f_title", "f_summary", "f_full"]
  .forEach(id => {
    document.getElementById(id).addEventListener("change", () => search(1));
  });

document.querySelectorAll(".event_filter").forEach(cb => {
  cb.addEventListener("change", () => search(1));
});

keyword.addEventListener("keydown", e => {
  if (e.key === "Enter") search(1);
});


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
  date_to.value = maxDate;
  date_from.max = maxDate;
  date_to.max = maxDate;

  const datasetMin = "2025-10-01";
  date_from.min = datasetMin;
  date_to.min = date_from.value || datasetMin;

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

  const exportData = currentRows.map((r, i) => ({
    "No": i + 1,
    "Judul": r.title || "-",
    "Tanggal": r.publication_datetime ? formatDateIndo(r.publication_datetime) : "-",
    "Sumber": r.source || "-",
    "Wilayah": r.region_final || "-",
    "Kategori": r.category || "-",
    "Status Kejadian": r.event_time || "-",
    "PDRB Relevan": r.pdrb_relevan || "-",
    "Justifikasi PDRB": r.justifikasi_pdrb || "-",
    "Lap. Usaha": r.lapus || "-",
    "Lap. Usaha 2": r.lapus_second || "-",
    "Ringkasan": r.summary || "-",
    "URL": r.url || "-",
  }));

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
    { wch: 40 },  // Justifikasi PDRB
    { wch: 15 },  // Lap. Usaha
    { wch: 15 },  // Lap. Usaha 2
    { wch: 60 },  // Ringkasan
    { wch: 40 },  // URL
  ];

  const filename = `babelens_${date_from.value}_${date_to.value}.xlsx`;
  XLSX.writeFile(wb, filename);
}