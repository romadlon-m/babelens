// Page-specific validation for labeling-lapus.html — see labeling-common.js for the
// shared engine (queue/claim/submit/skip/copy) that this plugs into.
//
// Expected format (LABELING_TOOL_PLAN.md section 6):
//   [No]|||[Ya/Tidak]|||[Kategori atau -]|||[Alasan]|||[Naik/Turun/Netral/-]
//
// Kode kategori duplikat sengaja dari dashboard.js/news-search.js (LAPUS_LABELS) —
// repo ini sudah tidak punya modul bersama untuk daftar taksonomi, lihat CLAUDE.md.
const LAPUS_CODES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'MN', 'O', 'P', 'Q', 'RSTU'];
const ARAH_VALUES = ['Naik', 'Turun', 'Netral'];

function parseLapusLine(raw) {
  const parts = labelingSplitPipes(raw, 5);
  const [, relevanRaw, kategoriRaw, alasan, arahRaw] = parts;

  const relevanNorm = relevanRaw.toLowerCase();
  let relevan;
  if (relevanNorm === 'ya') relevan = 'Ya';
  else if (relevanNorm === 'tidak') relevan = 'Tidak';
  else throw new Error(`Kolom ke-2 harus "Ya" atau "Tidak", ditemukan "${relevanRaw}".`);

  if (!alasan) throw new Error('Kolom ke-4 (alasan) tidak boleh kosong.');

  if (relevan === 'Tidak') {
    if (kategoriRaw !== '-') throw new Error('Kolom ke-3 (kategori) harus "-" ketika kolom ke-2 = Tidak.');
    if (arahRaw !== '-') throw new Error('Kolom ke-5 (arah) harus "-" ketika kolom ke-2 = Tidak.');
    return { hasil: { relevan: 'Tidak', kategori: [], alasan, arah: null } };
  }

  // relevan === 'Ya'
  const kategori = kategoriRaw.split(',').map(k => k.trim().toUpperCase()).filter(Boolean);
  if (kategori.length < 1 || kategori.length > 2) {
    throw new Error('Kolom ke-3 (kategori) harus berisi 1-2 kode ketika kolom ke-2 = Ya.');
  }
  for (const k of kategori) {
    if (!LAPUS_CODES.includes(k)) {
      throw new Error(`Kode kategori "${k}" tidak dikenal. Kode valid: ${LAPUS_CODES.join(', ')}.`);
    }
  }

  const arahNorm = arahRaw.trim();
  const arahMatch = ARAH_VALUES.find(v => v.toLowerCase() === arahNorm.toLowerCase());
  if (!arahMatch) {
    throw new Error(`Kolom ke-5 (arah) harus salah satu dari ${ARAH_VALUES.join('/')} ketika kolom ke-2 = Ya.`);
  }

  return { hasil: { relevan: 'Ya', kategori, alasan, arah: arahMatch } };
}

// initLabelingPage() is invoked from labeling-lapus.html's inline script, after the
// requireAuth()/is_labeler gate passes — not here, so an unauthorized visitor never
// even starts claiming rows.
