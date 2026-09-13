// Shared engine for the 3 labeling pages (labeling-screener.html / labeling-lapus.html /
// labeling-pengeluaran.html). Each page only supplies a `jenis` and a `parseLine()`
// function (see labeling-screener.js / labeling-lapus.js / labeling-pengeluaran.js) —
// everything else (queue counter, claim/skip/submit, prompt fetch, copy-to-clipboard)
// lives here so the three pages stay in sync. Mirrors the shared-script precedent of
// auth.js/sidebar.js rather than duplicating this logic 3x.
//
// See news-scraper-babel/LABELING_TOOL_PLAN.md (private repo) for the full design.

const SUBMIT_LABEL_FN_URL = 'https://cyqqohycenkoludiefgq.supabase.co/functions/v1/submit-label';

function labelingEscapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

// Shared by the 3 page-specific parseLine() implementations: takes the pasted
// textarea value, keeps only the first non-empty line (tolerates a stray leading/
// trailing blank line from copy-paste), and splits on the "|||" separator.
function labelingSplitPipes(raw, expectedCount) {
  const lines = (raw || '').split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) throw new Error('Tempel hasil AI terlebih dahulu.');
  if (lines.length > 1) throw new Error('Hanya boleh satu baris hasil (satu artikel per submit).');
  const parts = lines[0].split('|||').map(p => p.trim());
  if (parts.length !== expectedCount) {
    throw new Error(`Format salah: harus ada tepat ${expectedCount} bagian dipisah "|||", ditemukan ${parts.length}.`);
  }
  return parts;
}

// "No" in the pasted AI result is the news.id embedded by labelingFormatArticleForPrompt()
// (not a sequential counter) — checking it here catches an intern pasting back a result
// for a different article than the one currently on screen.
function labelingCheckNo(noRaw, expectedId) {
  const no = parseInt(noRaw, 10);
  if (!Number.isFinite(no)) {
    throw new Error(`Kolom ke-1 (No) harus berupa ID berita (angka), ditemukan "${noRaw}".`);
  }
  if (no !== expectedId) {
    throw new Error(`Kolom ke-1 (No = ${no}) tidak cocok dengan artikel yang sedang ditampilkan (ID ${expectedId}). Pastikan hasil AI ini untuk artikel yang benar.`);
  }
}

function labelingFormatDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
}

function labelingFormatArticleForPrompt(row) {
  return `${row.id}. Judul: ${row.title || '-'}\nTanggal: ${labelingFormatDate(row.publication_datetime)}\nSumber: ${row.source || '-'}\nIsi: ${row.content || row.summary || '-'}`;
}

async function labelingCopyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    // Fallback for browsers/contexts without Clipboard API permission.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }
}

// Marks the current stage active in the shared 3-item subnav markup (identical
// on all 3 labeling-*.html pages, like sidebar.js's setActiveNav() for the top nav).
function renderLabelingSubnav(jenis) {
  const nav = document.getElementById('labeling-subnav');
  if (!nav) return;
  nav.querySelectorAll('.labeling-subnav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.jenis === jenis);
  });
}

async function labelingFetchActivePrompt(jenis) {
  const { data, error } = await window.db
    .from('label_prompts')
    .select('id, isi_prompt, versi')
    .eq('jenis', jenis)
    .eq('is_active', true)
    .maybeSingle();
  if (error) throw new Error('Gagal memuat prompt aktif: ' + error.message);
  if (!data) throw new Error(`Belum ada prompt aktif untuk jenis "${jenis}".`);
  return data;
}

// RPC rather than a client-side query so this can never drift from what
// claim_next_news_for_labeling() actually considers queued (e.g. flagged-row
// exclusion) — see labeling_queue_count() in the labeling_flags migration.
async function labelingQueueCount(jenis) {
  const { data, error } = await window.db.rpc('labeling_queue_count', { p_jenis: jenis });
  if (error) throw new Error('Gagal menghitung antrean: ' + error.message);
  return data ?? 0;
}

async function labelingClaimNext(jenis) {
  const { data, error } = await window.db.rpc('claim_next_news_for_labeling', { p_jenis: jenis });
  if (error) throw new Error('Gagal mengambil antrean: ' + error.message);
  if (!data || data.id == null) return null;
  return data;
}

// Direct-access counterpart used when the page is opened as
// labeling-{jenis}.html?news_id=123 (e.g. from admin Detail Baris) — loads that
// exact row instead of the next one in queue, bypassing the normal ordering and
// the flag exclusion (the whole point of opening this way is often to resolve a
// flagged row) and overriding any existing soft-lock.
async function labelingClaimSpecific(jenis, newsId) {
  const { data, error } = await window.db.rpc('claim_specific_news_for_labeling', { p_news_id: newsId, p_jenis: jenis });
  if (error) throw new Error('Gagal membuka berita: ' + error.message);
  return data;
}

async function labelingReleaseLock(newsId, jenis) {
  const { error } = await window.db.rpc('release_news_lock', { p_news_id: newsId, p_jenis: jenis });
  if (error) throw new Error('Gagal melepas kunci: ' + error.message);
}

async function labelingFlag(newsId, jenis, reason) {
  const { error } = await window.db.rpc('flag_news_for_labeling', { p_news_id: newsId, p_jenis: jenis, p_reason: reason });
  if (error) throw new Error('Gagal menandai berita: ' + error.message);
}

async function labelingSubmit(newsId, jenis, hasil) {
  const { data: { session } } = await window.db.auth.getSession();
  if (!session) throw new Error('Sesi tidak valid, silakan login ulang.');
  const res = await fetch(SUBMIT_LABEL_FN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${session.access_token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ news_id: newsId, jenis, hasil })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || 'Gagal mengirim label');
  return body;
}

/**
 * Wires up a labeling page. `config`:
 *   - jenis: 'screener' | 'lapus' | 'pengeluaran'
 *   - parseLine(rawText): returns { hasil } on success or throws Error(message) on
 *     invalid input. `hasil` must match the shape submit-label expects for the jenis.
 */
function initLabelingPage(config) {
  const { jenis, parseLine } = config;

  renderLabelingSubnav(jenis);

  const els = {
    queueCount: document.getElementById('labeling-queue-count'),
    card: document.getElementById('labeling-card'),
    empty: document.getElementById('labeling-empty'),
    title: document.getElementById('labeling-title'),
    meta: document.getElementById('labeling-meta'),
    content: document.getElementById('labeling-content'),
    btnCopy: document.getElementById('btn-copy-prompt'),
    textarea: document.getElementById('result-textarea'),
    btnSubmit: document.getElementById('btn-submit'),
    btnSkip: document.getElementById('btn-skip'),
    btnFlag: document.getElementById('btn-flag'),
    validationMsg: document.getElementById('validation-msg')
  };

  let currentRow = null;
  let activePrompt = null;

  function resetResultArea() {
    els.textarea.value = '';
    els.validationMsg.textContent = '';
    els.validationMsg.className = 'labeling-validation-msg';
  }

  function renderRow(row) {
    currentRow = row;
    if (!row) {
      els.card.hidden = true;
      els.empty.hidden = false;
      resetResultArea();
      return;
    }
    els.empty.hidden = true;
    els.card.hidden = false;
    els.title.textContent = row.title || '(tanpa judul)';
    els.meta.innerHTML = [
      `📅 ${labelingEscapeHtml(labelingFormatDate(row.publication_datetime))}`,
      `📰 ${labelingEscapeHtml(row.source || '-')}`,
      row.category ? `🏷️ ${labelingEscapeHtml(row.category)}` : ''
    ].filter(Boolean).map(s => `<span>${s}</span>`).join('');
    els.content.textContent = row.content || row.summary || '(tidak ada isi)';
    resetResultArea();
  }

  async function refreshQueueCount() {
    try {
      const n = await labelingQueueCount(jenis);
      els.queueCount.innerHTML = `Sisa antrean: <strong>${n}</strong> baris`;
    } catch (err) {
      els.queueCount.textContent = 'Sisa antrean: (gagal memuat)';
      console.error(err);
    }
  }

  async function loadNext() {
    els.card.hidden = true;
    els.empty.hidden = true;
    try {
      const row = await labelingClaimNext(jenis);
      renderRow(row);
    } catch (err) {
      alert(err.message);
    }
  }

  async function handleCopy() {
    if (!currentRow || !activePrompt) return;
    const text = activePrompt.isi_prompt + '\n' + labelingFormatArticleForPrompt(currentRow);
    const ok = await labelingCopyToClipboard(text);
    const original = els.btnCopy.textContent;
    els.btnCopy.textContent = ok ? '✅ Disalin!' : '❌ Gagal menyalin';
    setTimeout(() => { els.btnCopy.textContent = original; }, 1800);
  }

  // Validasi dan Kirim digabung jadi satu klik: kalau format salah, submit tidak
  // pernah dipanggil (berhenti di error, tidak ada request jaringan). Sengaja tidak
  // dipisah lagi jadi 2 tombol — intern sempat lupa klik "Kirim" setelah "Validasi"
  // sehingga hasil labelingnya tidak pernah tersimpan.
  async function handleValidateAndSubmit() {
    els.validationMsg.className = 'labeling-validation-msg';

    let hasil;
    try {
      ({ hasil } = parseLine(els.textarea.value, currentRow?.id));
    } catch (err) {
      els.validationMsg.textContent = '❌ ' + err.message;
      els.validationMsg.classList.add('error');
      return;
    }
    if (!currentRow) return;

    els.validationMsg.textContent = 'Mengirim...';
    els.btnSubmit.disabled = true;
    els.btnSkip.disabled = true;
    try {
      await labelingSubmit(currentRow.id, jenis, hasil);
      await refreshQueueCount();
      await loadNext();
    } catch (err) {
      els.validationMsg.textContent = '❌ Gagal mengirim: ' + err.message;
      els.validationMsg.classList.add('error');
    } finally {
      els.btnSubmit.disabled = false;
      els.btnSkip.disabled = false;
    }
  }

  async function handleSkip() {
    if (!currentRow) return;
    els.btnSkip.disabled = true;
    try {
      await labelingReleaseLock(currentRow.id, jenis);
      await refreshQueueCount();
      await loadNext();
    } catch (err) {
      alert('Gagal melewati: ' + err.message);
    } finally {
      els.btnSkip.disabled = false;
    }
  }

  // "Lewati" only releases the lock — the row goes right back into the queue, so
  // it's for a transient reason (came back to this article, want a different one
  // next). Use "Tandai Bermasalah" instead when the AI itself won't cooperate
  // (e.g. it answers with a sympathetic/safety message instead of the format for
  // sensitive topics like suicide/depression) — that permanently pulls the row out
  // of this stage's queue rather than sending the next intern into the same wall.
  async function handleFlag() {
    if (!currentRow) return;
    const reason = prompt('Alasan menandai (opsional) — mis. "AI menolak merespon karena konten sensitif":', '');
    if (reason === null) return; // cancelled
    els.btnFlag.disabled = true;
    els.btnSkip.disabled = true;
    try {
      await labelingFlag(currentRow.id, jenis, reason);
      await refreshQueueCount();
      await loadNext();
    } catch (err) {
      alert('Gagal menandai: ' + err.message);
    } finally {
      els.btnFlag.disabled = false;
      els.btnSkip.disabled = false;
    }
  }

  els.btnCopy.addEventListener('click', handleCopy);
  els.btnSubmit.addEventListener('click', handleValidateAndSubmit);
  els.btnSkip.addEventListener('click', handleSkip);
  els.btnFlag.addEventListener('click', handleFlag);

  // ?news_id=123 (e.g. a link from admin Detail Baris) opens that exact article
  // directly instead of the next one in queue — only for the very first load;
  // stripped from the URL right away so a refresh or the normal "next" flow after
  // submit/skip/flag falls back to the regular queue, not this same row again.
  async function loadInitial() {
    const params = new URLSearchParams(window.location.search);
    const newsIdParam = params.get('news_id');
    if (newsIdParam && /^\d+$/.test(newsIdParam)) {
      history.replaceState(null, '', window.location.pathname);
      els.card.hidden = true;
      els.empty.hidden = true;
      try {
        const row = await labelingClaimSpecific(jenis, parseInt(newsIdParam, 10));
        renderRow(row);
        return;
      } catch (err) {
        alert(err.message);
      }
    }
    await loadNext();
  }

  (async () => {
    try {
      activePrompt = await labelingFetchActivePrompt(jenis);
    } catch (err) {
      alert(err.message);
    }
    await refreshQueueCount();
    await loadInitial();
  })();
}
