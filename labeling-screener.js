// Page-specific validation for labeling-screener.html — see labeling-common.js for the
// shared engine (queue/claim/submit/skip/copy) that this plugs into.
//
// Expected format (LABELING_TOOL_PLAN.md section 6):
//   [No]|||[Lolos/Tidak Lolos]|||[Alasan singkat, maksimal 20 kata]

function parseScreenerLine(raw) {
  const parts = labelingSplitPipes(raw, 3);
  const [, lolosRaw, alasan] = parts;

  const normalized = lolosRaw.toLowerCase();
  let lolos;
  if (normalized === 'lolos') lolos = true;
  else if (normalized === 'tidak lolos') lolos = false;
  else throw new Error(`Kolom ke-2 harus "Lolos" atau "Tidak Lolos", ditemukan "${lolosRaw}".`);

  if (!alasan) throw new Error('Kolom ke-3 (alasan) tidak boleh kosong.');

  return { hasil: { lolos, alasan } };
}

// initLabelingPage() is invoked from labeling-screener.html's inline script, after the
// requireAuth()/is_labeler gate passes — not here, so an unauthorized visitor never
// even starts claiming rows.
