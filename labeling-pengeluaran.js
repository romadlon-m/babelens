// Page-specific validation for labeling-pengeluaran.html — see labeling-common.js for
// the shared engine (queue/claim/submit/skip/copy) that this plugs into.
//
// Expected format (LABELING_TOOL_PLAN.md section 6):
//   [No]|||[Ya/Tidak]|||[Komponen atau -]|||[Alasan]|||[Naik/Turun/Netral/-]
// [No] harus persis ID berita (news.id), lihat catatan di labeling-screener.js.
//
// Kode komponen duplikat sengaja dari dashboard.js/news-search.js
// (PENGELUARAN_LABELS, sisi Provinsi) — repo ini sudah tidak punya modul bersama
// untuk daftar taksonomi, lihat CLAUDE.md.
const PENGELUARAN_CODES = ['1a', '1b', '1c', '1d', '1e', '1f', '1g', '1h', '1i', '1j', '1k', '1l', '1', '2', '3', '4', '5', '6', '7'];
const ARAH_VALUES = ['Naik', 'Turun', 'Netral'];

function parsePengeluaranLine(raw, expectedId) {
  const parts = labelingSplitPipes(raw, 5);
  const [noRaw, relevanRaw, komponenRaw, alasan, arahRaw] = parts;
  labelingCheckNo(noRaw, expectedId);

  const relevanNorm = relevanRaw.toLowerCase();
  let relevan;
  if (relevanNorm === 'ya') relevan = 'Ya';
  else if (relevanNorm === 'tidak') relevan = 'Tidak';
  else throw new Error(`Kolom ke-2 harus "Ya" atau "Tidak", ditemukan "${relevanRaw}".`);

  if (!alasan) throw new Error('Kolom ke-4 (alasan) tidak boleh kosong.');

  if (relevan === 'Tidak') {
    if (komponenRaw !== '-') throw new Error('Kolom ke-3 (komponen) harus "-" ketika kolom ke-2 = Tidak.');
    if (arahRaw !== '-') throw new Error('Kolom ke-5 (arah) harus "-" ketika kolom ke-2 = Tidak.');
    return { hasil: { relevan: 'Tidak', komponen: [], alasan, arah: null } };
  }

  // relevan === 'Ya'
  const komponen = komponenRaw.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
  if (komponen.length < 1 || komponen.length > 2) {
    throw new Error('Kolom ke-3 (komponen) harus berisi 1-2 kode ketika kolom ke-2 = Ya.');
  }
  for (const k of komponen) {
    if (!PENGELUARAN_CODES.includes(k)) {
      throw new Error(`Kode komponen "${k}" tidak dikenal. Kode valid: ${PENGELUARAN_CODES.join(', ')}.`);
    }
  }

  const arahNorm = arahRaw.trim();
  const arahMatch = ARAH_VALUES.find(v => v.toLowerCase() === arahNorm.toLowerCase());
  if (!arahMatch) {
    throw new Error(`Kolom ke-5 (arah) harus salah satu dari ${ARAH_VALUES.join('/')} ketika kolom ke-2 = Ya.`);
  }

  return { hasil: { relevan: 'Ya', komponen, alasan, arah: arahMatch } };
}

// initLabelingPage() is invoked from labeling-pengeluaran.html's inline script, after
// the requireAuth()/is_labeler gate passes — not here, so an unauthorized visitor
// never even starts claiming rows.
