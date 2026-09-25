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
    text: 'Aktifkan untuk hanya menampilkan berita yang dinilai relevan terhadap PDRB oleh AI. Kami aktifkan dulu sebagai contoh — hasil pencarian akan langsung menyesuaikan.',
  },
  {
    page: 'news.html',
    selector: '#result .news-card:first-child',
    title: 'Label pada Berita',
    text: 'Setiap kartu berita PDRB relevan menampilkan badge lapangan usaha dan/atau komponen pengeluaran hasil klasifikasi AI. Arahkan kursor ke tiap badge untuk detail lebih lanjut.',
    waitFor: true,
  },
];

// Temporary diagnostic logging (2026-09-25) while chasing a report of the
// tour silently stopping when navigating from index.html to news.html —
// no console errors were seen, so these trace the actual decision points
// instead of guessing further. Safe to remove once the cause is confirmed.
function tourLog(...args) {
  console.log('[tour]', ...args);
}

function tourCurrentPage() {
  const path = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  return path === '' ? 'index.html' : path;
}

// Some local dev servers serve pages without the ".html" extension in the
// URL (e.g. "/news" instead of "/news.html") — confirmed 2026-09-25 via a
// real user report (their localhost:3000 setup). TOUR_STEPS' `page` values
// keep the ".html" suffix (still needed for the literal navigation target in
// tourGoTo()/startTour()), so every page-name comparison must go through
// this instead of comparing the raw strings directly.
function tourNormalizePage(name) {
  return (name || '').toLowerCase().replace(/\.html$/, '');
}

function tourPagesMatch(a, b) {
  return tourNormalizePage(a) === tourNormalizePage(b);
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

// Steps 5 and 6 (0-based: "Hanya PDRB Relevan" then "Label pada Berita") turn
// the PDRB filter on for real so the demo is concrete and the last step's
// spotlighted card is reliably already labeled (PDRB-relevant implies
// lu_relevan/pengeluaran_relevan is filled) instead of "Dalam Proses
// Analisis". The toggle's checked state is persisted to localStorage by
// news-search.js on every change, so it must be restored to whatever it was
// before the demo once the user leaves that range — otherwise the tour would
// silently change the user's saved filter preference for future visits.
const PDRB_DEMO_STEP_INDICES = [5, 6];
let tourPdrbOriginalChecked = null;

function tourApplyPdrbDemo() {
  if (tourPdrbOriginalChecked !== null) return; // already applied
  const el = document.getElementById('pdrb_only');
  if (!el) return;
  tourPdrbOriginalChecked = el.checked;
  if (!el.checked) {
    el.checked = true;
    el.dispatchEvent(new Event('change'));
  }
}

function tourRevertPdrbDemo() {
  if (tourPdrbOriginalChecked === null) return;
  const el = document.getElementById('pdrb_only');
  if (el && el.checked !== tourPdrbOriginalChecked) {
    el.checked = tourPdrbOriginalChecked;
    el.dispatchEvent(new Event('change'));
  }
  tourPdrbOriginalChecked = null;
}

function endTour() {
  tourRevertPdrbDemo();
  tourClearState();
  tourRemoveOverlay();
  tourCurrentIndex = null;
}

function finishTour() {
  tourRevertPdrbDemo();
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
  tourLog('showStep() called with index', index, 'on page', tourCurrentPage());
  const step = TOUR_STEPS[index];
  if (!step) { tourLog('showStep(): no step at index', index, '- finishing'); finishTour(); return; }
  if (!isTourDesktop()) { tourLog('showStep(): not desktop width (' + window.innerWidth + 'px) - ending'); endTour(); return; }

  const el = await waitForElement(step.selector, step.waitFor ? 5000 : 3000);
  if (!el) { tourLog('showStep(): selector', JSON.stringify(step.selector), 'not found in time - skipping to next step'); tourGoTo(index + 1); return; }
  tourLog('showStep(): found target element for', JSON.stringify(step.selector), '- rendering step', index + 1, 'of', TOUR_STEPS.length);

  tourCurrentIndex = index;
  sessionStorage.setItem(TOUR_ACTIVE_KEY, '1');
  sessionStorage.setItem(TOUR_STEP_KEY, String(index));

  if (PDRB_DEMO_STEP_INDICES.includes(index)) {
    tourApplyPdrbDemo();
  } else {
    tourRevertPdrbDemo();
  }

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
  tourLog('tourGoTo(' + newIndex + ') called, current page:', tourCurrentPage());
  window.removeEventListener('scroll', tourRepositionCurrent, true);
  window.removeEventListener('resize', tourRepositionCurrent);

  if (newIndex < 0) return;
  if (newIndex >= TOUR_STEPS.length) { tourLog('tourGoTo(): past last step - finishing'); finishTour(); return; }

  const step = TOUR_STEPS[newIndex];
  sessionStorage.setItem(TOUR_ACTIVE_KEY, '1');
  sessionStorage.setItem(TOUR_STEP_KEY, String(newIndex));
  tourLog('tourGoTo(): saved sessionStorage step =', newIndex, ', target step page =', step.page);

  if (!tourPagesMatch(step.page, tourCurrentPage())) {
    tourLog('tourGoTo(): target page differs from current page - navigating to', step.page);
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
  if (!tourPagesMatch(firstStepPage, tourCurrentPage())) {
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
  const activeFlag = sessionStorage.getItem(TOUR_ACTIVE_KEY);
  const storedIdx = sessionStorage.getItem(TOUR_STEP_KEY);
  tourLog('resumeTourIfActive(): active flag =', activeFlag, ', stored step =', storedIdx, ', page =', tourCurrentPage(), ', innerWidth =', window.innerWidth);
  if (activeFlag !== '1') { tourLog('resumeTourIfActive(): no active tour in sessionStorage'); return false; }
  if (!isTourDesktop()) { tourLog('resumeTourIfActive(): not desktop width - ending tour'); endTour(); return false; }
  const idx = parseInt(storedIdx || '0', 10);
  const step = TOUR_STEPS[idx];
  if (!step || !tourPagesMatch(step.page, tourCurrentPage())) {
    tourLog('resumeTourIfActive(): stored step page (' + (step && step.page) + ') does not match current page - not resuming here');
    return true; // tour active, just not this page's turn
  }
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
  if (!tourPagesMatch(tourCurrentPage(), 'index.html')) return;
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
  tourLog('initOnboarding() called on', tourCurrentPage());
  if (resumeTourIfActive()) return;
  maybeShowOnboardingModal();
}
