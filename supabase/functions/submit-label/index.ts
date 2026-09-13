import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const JENIS_VALUES = ['screener', 'lapus', 'pengeluaran'] as const
type Jenis = typeof JENIS_VALUES[number]

const LAPUS_CODES = new Set(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'MN', 'O', 'P', 'Q', 'RSTU'])
const PENGELUARAN_CODES = new Set(['1a', '1b', '1c', '1d', '1e', '1f', '1g', '1h', '1i', '1j', '1k', '1l', '1', '2', '3', '4', '5', '6', '7'])
const ARAH_VALUES = new Set(['Naik', 'Turun', 'Netral'])

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}

// Validates the `hasil` payload shape for the given jenis. Returns an error string,
// or null if valid. This mirrors (and double-checks server-side) the validation the
// labeling pages already do client-side before showing the "Kirim" button.
function validateHasil(jenis: Jenis, hasil: any): string | null {
  if (!hasil || typeof hasil !== 'object') return 'hasil wajib berupa object'

  if (jenis === 'screener') {
    if (typeof hasil.lolos !== 'boolean') return 'hasil.lolos wajib boolean'
    if (typeof hasil.alasan !== 'string' || !hasil.alasan.trim()) return 'hasil.alasan wajib diisi'
    return null
  }

  // lapus / pengeluaran share the same shape
  if (hasil.relevan !== 'Ya' && hasil.relevan !== 'Tidak') return 'hasil.relevan wajib "Ya" atau "Tidak"'
  if (typeof hasil.alasan !== 'string' || !hasil.alasan.trim()) return 'hasil.alasan wajib diisi'

  const codeSet = jenis === 'lapus' ? LAPUS_CODES : PENGELUARAN_CODES
  const listField = jenis === 'lapus' ? 'kategori' : 'komponen'

  if (hasil.relevan === 'Tidak') {
    if (hasil[listField] != null && !(Array.isArray(hasil[listField]) && hasil[listField].length === 0)) {
      return `hasil.${listField} wajib kosong ("-") ketika relevan = Tidak`
    }
    if (hasil.arah != null) return 'hasil.arah wajib "-" ketika relevan = Tidak'
    return null
  }

  // relevan === 'Ya'
  if (!Array.isArray(hasil[listField]) || hasil[listField].length < 1 || hasil[listField].length > 2) {
    return `hasil.${listField} wajib berisi 1-2 kode ketika relevan = Ya`
  }
  for (const code of hasil[listField]) {
    if (!codeSet.has(code)) return `kode ${listField} tidak dikenal: ${code}`
  }
  if (!ARAH_VALUES.has(hasil.arah)) return 'hasil.arah wajib salah satu dari Naik/Turun/Netral ketika relevan = Ya'

  return null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return json({ error: 'No authorization header' }, 401)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const secretKey = Deno.env.get('PROJECT_SECRET_KEY')!
    const publishableKey = Deno.env.get('PROJECT_PUBLISHABLE_KEY')!

    // Step 1: verify the caller's JWT — derive user id from token, never trust request body
    const userClient = createClient(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: authHeader } }
    })
    const { data: { user }, error: userError } = await userClient.auth.getUser()
    if (userError || !user) {
      return json({ error: 'Invalid or expired session' }, 401)
    }

    const adminClient = createClient(supabaseUrl, secretKey)

    // Step 2: caller must be an active labeler or an admin (admins can work the
    // labeling queue too — e.g. to resolve a flagged row directly)
    const { data: callerProfile, error: callerError } = await adminClient
      .from('profiles')
      .select('is_labeler, is_admin')
      .eq('id', user.id)
      .maybeSingle()

    if (callerError) {
      return json({ error: 'Failed to check caller profile: ' + callerError.message }, 500)
    }
    if (!callerProfile?.is_labeler && !callerProfile?.is_admin) {
      return json({ error: 'Forbidden — labeler or admin only' }, 403)
    }

    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {}
    const newsId = body?.news_id
    const jenis = body?.jenis as Jenis
    const hasil = body?.hasil

    if (!Number.isInteger(newsId)) {
      return json({ error: 'news_id wajib berupa integer' }, 400)
    }
    if (!JENIS_VALUES.includes(jenis)) {
      return json({ error: 'jenis wajib salah satu dari: ' + JENIS_VALUES.join(', ') }, 400)
    }

    const validationError = validateHasil(jenis, hasil)
    if (validationError) {
      return json({ error: validationError }, 400)
    }

    // Look up the currently active prompt for this jenis server-side (not trusted from
    // client) so labeling_log always records which prompt version produced the result.
    const { data: activePrompt } = await adminClient
      .from('label_prompts')
      .select('id')
      .eq('jenis', jenis)
      .eq('is_active', true)
      .maybeSingle()

    // Step 3: atomic write via the submit_label() Postgres function — updates `news`,
    // inserts the labeling_log audit row, and releases the assignment lock, all in one
    // statement so a partial failure can't leave `news`/`labeling_log` inconsistent.
    const { data: rpcResult, error: rpcError } = await adminClient.rpc('submit_label', {
      p_news_id: newsId,
      p_jenis: jenis,
      p_labeler_id: user.id,
      p_hasil: hasil,
      p_prompt_version_id: activePrompt?.id ?? null,
      p_batch_tag: null
    })

    if (rpcError) {
      return json({ error: 'Gagal menyimpan label: ' + rpcError.message }, 500)
    }

    return json({ ok: true, result: rpcResult })

  } catch (err) {
    return json({ error: 'Internal server error: ' + (err instanceof Error ? err.message : String(err)) }, 500)
  }
})
