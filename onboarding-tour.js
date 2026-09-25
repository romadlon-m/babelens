// Interactive onboarding tour — coach-marks over key Beranda/Pencarian Berita
// UI. Desktop only (window.innerWidth > 767 — see CLAUDE.md "Next priority:
// interactive onboarding tour"). State is kept in sessionStorage so the tour
// survives the navigation from index.html to news.html mid-sequence.
// Requires dialog.js (showConfirm) to be loaded first.

const TOUR_ACTIVE_KEY = 'babelens_tour_active';
const TOUR_STEP_KEY = 'babelens_tour_step';

const TOUR_STEPS = [
  {
    page: 'index.html',
    selector: '.stat-cards',
    title: 'Kartu Ringkasan',
    text: 'Menampilkan total berita, jumlah yang relevan PDRB, serta cakupan lapangan usaha, komponen pengeluaran, dan wilayah — semuanya mengikuti filter yang aktif.',
  },
  {
    page: 'index.html',
    selector: '#dash_preset',
    title: 'Filter Beranda',
    text: 'Pilih periode cepat, atau atur wilayah dan tanggal secara manual di sidebar ini. Semua grafik dan kartu akan diperbarui otomatis.',
  },
  {
    page: 'index.html',
    selector: '#wrap-tren',
    title: 'Grafik Tren Berita',
    text: 'Menampilkan jumlah berita per bulan, dibedakan antara yang relevan PDRB (hijau) dan tidak (abu-abu).',
  },
  {
    page: 'news.html',
    selector: '#keyword',
    title: 'Kata Kunci',
    text: 'Cari berita berdasarkan kata tertentu. Bisa lebih dari satu kata, atau gunakan tanda kutip untuk mencari frasa persis.',
  },
  {
    page: 'news.html',
    selector: '#region',
    title: 'Filter Pencarian',
    text: 'Persempit hasil berdasarkan wilayah, lapangan usaha, komponen pengeluaran, periode, dan status kejadian di sidebar ini.',
  },
  {
    page: 'news.html',
    selector: '.pdrb-toggle-label',
    title: 'Hanya PDRB Relevan',
    text: 'Aktifkan untuk hanya menampilkan berita yang dinilai relevan terhadap PDRB oleh AI.',
  },
  {
    page: 'news.html',
    selector: '#result .news-card:first-child',
    title: 'Label pada Berita',
    text: 'Setiap kartu berita menampilkan label PDRB, lapangan usaha, dan komponen pengeluaran hasil klasifikasi AI. Arahkan kursor ke tiap label untuk detail lebih lanjut.',
    waitFor: true,
  },
];

function tourCurrentPage() {
  const path = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  return path === '' ? 'index.html' : path;
}

function isTourDesktop() {
  return window.innerWidth > 767;
}

function tourClearState() {
  sessionStorage.removeItem(TOUR_ACTIVE_KEY);
  sessionStorage.removeItem(TOUR_STEP_KEY);
}

function tourRemoveOverlay() {
  const overlay = document.getElementById('tour-overlay');
  if (overlay) overlay.remove();
  window.removeEventListener('scroll', tourRepositionCurrent, true);
  window.removeEventListener('resize', tourRepositionCurrent);
}

let tourCurrentIndex = null;

function endTour() {
  tourClearState();
  tourRemoveOverlay();
  tourCurrentIndex = null;
}

function finishTour() {
  tourClearState();
  tourRemoveOverlay();
  tourCurrentIndex = null;
  showTourToast('Tur selesai! Buka lagi kapan saja lewat menu Panduan.');
}

function waitForElement(selector, timeout) {
  return new Promise(resolve => {
    const existing = document.querySelector(selector);
    if (existing) { resolve(existing); return; }
    const start = Date.now();
    const interval = setInterval(() => {
      const el = document.querySelector(selector);
      if (el) {
        clearInterval(interval);
        resolve(el);
      } else if (Date.now() - start > timeout) {
        clearInterval(interval);
        resolve(null);
      }
    }, 150);
  });
}

function tourBuildOverlay() {
  let overlay = document.getElementById('tour-overlay');
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.id = 'tour-overlay';
  overlay.className = 'tour-overlay';
  overlay.innerHTML = `
    <div class="tour-spotlight" id="tour-spotlight"></div>
    <div class="tour-tooltip" id="tour-tooltip" role="dialog" aria-modal="true">
      <div class="tour-tooltip-header">
        <span class="tour-step-counter" id="tour-step-counter"></span>
        <button type="button" class="tour-close-btn" id="tour-close-btn" aria-label="Tutup tur">&times;</button>
      </div>
      <div class="tour-tooltip-title" id="tour-tooltip-title"></div>
      <div class="tour-tooltip-text" id="tour-tooltip-text"></div>
      <div class="tour-tooltip-actions">
        <button type="button" class="tour-btn tour-btn-secondary" id="tour-prev-btn">‹ Sebelumnya</button>
        <button type="button" class="tour-btn tour-btn-primary" id="tour-next-btn">Selanjutnya ›</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('tour-close-btn').addEventListener('click', endTour);
  document.getElementById('tour-prev-btn').addEventListener('click', () => tourGoTo(tourCurrentIndex - 1));
  document.getElementById('tour-next-btn').addEventListener('click', () => tourGoTo(tourCurrentIndex + 1));
  return overlay;
}

function tourPositionAt(el) {
  const spotlight = document.getElementById('tour-spotlight');
  const tooltip = document.getElementById('tour-tooltip');
  if (!spotlight || !tooltip) return;

  const rect = el.getBoundingClientRect();
  const pad = 8;
  spotlight.style.left = `${rect.left - pad}px`;
  spotlight.style.top = `${rect.top - pad}px`;
  spotlight.style.width = `${rect.width + pad * 2}px`;
  spotlight.style.height = `${rect.height + pad * 2}px`;

  const tooltipW = tooltip.offsetWidth || 320;
  const tooltipH = tooltip.offsetHeight || 140;
  const spaceBelow = window.innerHeight - rect.bottom;
  let top = spaceBelow > tooltipH + 24 ? rect.bottom + 16 : rect.top - tooltipH - 16;
  top = Math.max(12, Math.min(top, window.innerHeight - tooltipH - 12));

  let left = rect.left;
  left = Math.max(12, Math.min(left, window.innerWidth - tooltipW - 12));

  tooltip.style.top = `${top}px`;
  tooltip.style.left = `${left}px`;
}

function tourRepositionCurrent() {
  if (tourCurrentIndex === null) return;
  const step = TOUR_STEPS[tourCurrentIndex];
  const el = document.querySelector(step.selector);
  if (el) tourPositionAt(el);
}

async function showStep(index) {
  const step = TOUR_STEPS[index];
  if (!step) { finishTour(); return; }
  if (!isTourDesktop()) { endTour(); return; }

  const el = await waitForElement(step.selector, step.waitFor ? 5000 : 3000);
  if (!el) { tourGoTo(index + 1); return; }

  tourCurrentIndex = index;
  sessionStorage.setItem(TOUR_ACTIVE_KEY, '1');
  sessionStorage.setItem(TOUR_STEP_KEY, String(index));

  tourBuildOverlay();
  document.getElementById('tour-step-counter').textContent = `Langkah ${index + 1} dari ${TOUR_STEPS.length}`;
  document.getElementById('tour-tooltip-title').textContent = step.title;
  document.getElementById('tour-tooltip-text').textContent = step.text;
  document.getElementById('tour-prev-btn').style.visibility = index === 0 ? 'hidden' : 'visible';
  document.getElementById('tour-next-btn').textContent = index === TOUR_STEPS.length - 1 ? 'Selesai' : 'Selanjutnya ›';

  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  setTimeout(() => tourPositionAt(el), 300);

  window.addEventListener('scroll', tourRepositionCurrent, true);
  window.addEventListener('resize', tourRepositionCurrent);
}

function tourGoTo(newIndex) {
  window.removeEventListener('scroll', tourRepositionCurrent, true);
  window.removeEventListener('resize', tourRepositionCurrent);

  if (newIndex < 0) return;
  if (newIndex >= TOUR_STEPS.length) { finishTour(); return; }

  const step = TOUR_STEPS[newIndex];
  sessionStorage.setItem(TOUR_ACTIVE_KEY, '1');
  sessionStorage.setItem(TOUR_STEP_KEY, String(newIndex));

  if (step.page !== tourCurrentPage()) {
    tourRemoveOverlay();
    window.location.href = step.page;
    return;
  }
  tourRemoveOverlay();
  showStep(newIndex);
}

function startTour() {
  if (!isTourDesktop()) return;
  sessionStorage.setItem(TOUR_ACTIVE_KEY, '1');
  sessionStorage.setItem(TOUR_STEP_KEY, '0');
  const firstStepPage = TOUR_STEPS[0].page;
  if (firstStepPage !== tourCurrentPage()) {
    window.location.href = firstStepPage;
    return;
  }
  showStep(0);
}

// Entry point used by guide.html's "💡 Mulai Tur Interaktif" — always restarts
// from the top regardless of has_seen_onboarding (that flag only gates the
// once-per-account automatic modal, see maybeShowOnboardingModal()).
function startTourFromBeginning() {
  if (!isTourDesktop()) return;
  startTour();
}

function resumeTourIfActive() {
  if (sessionStorage.getItem(TOUR_ACTIVE_KEY) !== '1') return false;
  if (!isTourDesktop()) { endTour(); return false; }
  const idx = parseInt(sessionStorage.getItem(TOUR_STEP_KEY) || '0', 10);
  const step = TOUR_STEPS[idx];
  if (!step || step.page !== tourCurrentPage()) return true; // tour active, just not this page's turn
  showStep(idx);
  return true;
}

// ────────────────────────────────────────────────────────────
// One-time toast (lighter-weight than dialog.js's blocking modal)
// ────────────────────────────────────────────────────────────
function showTourToast(message) {
  const toast = document.createElement('div');
  toast.className = 'tour-toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('tour-toast-visible'));
  setTimeout(() => {
    toast.classList.remove('tour-toast-visible');
    setTimeout(() => toast.remove(), 300);
  }, 5000);
}

// ────────────────────────────────────────────────────────────
// Automatic first-login trigger (Beranda only, logged-in only, desktop only)
// ────────────────────────────────────────────────────────────
async function maybeShowOnboardingModal() {
  if (!isTourDesktop()) return;
  if (tourCurrentPage() !== 'index.html') return;
  if (sessionStorage.getItem(TOUR_ACTIVE_KEY) === '1') return;

  const { data: { session } } = await window.db.auth.getSession();
  if (!session) return;

  const profile = await getCurrentProfile();
  if (!profile || profile.has_seen_onboarding) return;

  const wantsTour = await showConfirm(
    'Kenalan dengan fitur-fitur utama Babelens dalam beberapa langkah singkat: kartu ringkasan, filter, grafik di Beranda, lalu pencarian berita.',
    { title: 'Kenalan dulu dengan Babelens?', confirmText: 'Mulai Tur', cancelText: 'Lewati' }
  );

  await markOnboardingSeen(profile.id);

  if (wantsTour) {
    startTour();
  } else {
    showTourToast('Oke! Kamu bisa membuka bantuan ini kapan saja lewat ikon 💡 di menu Panduan.');
  }
}

// Called once per page (index.html / news.html) after the page's own auth
// check has resolved.
function initOnboarding() {
  if (resumeTourIfActive()) return;
  maybeShowOnboardingModal();
}
