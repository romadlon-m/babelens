import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Public endpoint (verify_jwt = false in config.toml): the caller is by definition
// someone who can't log in. It never resets anything — it only notifies the admin
// on Discord, who resets manually via admin-users. The response never reveals
// whether the NIP exists.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const NIP_RE = /^\d{9}$/
const PER_NIP_COOLDOWN_MINUTES = 15
const MAX_NOTIFICATIONS_PER_HOUR = 20

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}

const OK_RESPONSE = {
  ok: true,
  message: 'Permintaan diterima. Admin akan memprosesnya; setelah direset, Anda masuk dengan kata sandi default lalu diminta menggantinya.'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  try {
    const body = await req.json().catch(() => ({}))
    const nip = String(body?.nip ?? '').trim()
    if (!NIP_RE.test(nip)) {
      return json({ error: 'NIP harus 9 digit angka.' }, 400)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const secretKey = Deno.env.get('PROJECT_SECRET_KEY')!
    const webhookUrl = Deno.env.get('DISCORD_WEBHOOK_RESET')
    if (!webhookUrl) {
      console.error('DISCORD_WEBHOOK_RESET is not set')
      return json({ error: 'Layanan belum siap. Hubungi admin secara langsung.' }, 500)
    }

    const admin = createClient(supabaseUrl, secretKey)

    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('nama')
      .eq('nip_lama', nip)
      .maybeSingle()
    if (profileError) {
      console.error('profile lookup failed', profileError)
      return json({ error: 'Terjadi kesalahan. Coba lagi nanti.' }, 500)
    }

    const sinceNip = new Date(Date.now() - PER_NIP_COOLDOWN_MINUTES * 60_000).toISOString()
    const sinceHour = new Date(Date.now() - 60 * 60_000).toISOString()

    const { count: recentForNip, error: nipCountError } = await admin
      .from('password_reset_requests')
      .select('id', { count: 'exact', head: true })
      .eq('nip_lama', nip)
      .eq('notified', true)
      .gte('created_at', sinceNip)
    const { count: notifiedLastHour, error: hourCountError } = await admin
      .from('password_reset_requests')
      .select('id', { count: 'exact', head: true })
      .eq('notified', true)
      .gte('created_at', sinceHour)
    if (nipCountError || hourCountError) {
      console.error('throttle lookup failed', nipCountError || hourCountError)
      return json({ error: 'Terjadi kesalahan. Coba lagi nanti.' }, 500)
    }

    const shouldNotify = !!profile
      && (recentForNip ?? 0) === 0
      && (notifiedLastHour ?? 0) < MAX_NOTIFICATIONS_PER_HOUR

    if (shouldNotify) {
      const waktu = new Date().toLocaleString('id-ID', {
        timeZone: 'Asia/Jakarta',
        day: 'numeric', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      })
      const discordRes = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content:
            '🔑 **Permintaan reset kata sandi**\n'
            + `Nama: ${profile!.nama}\n`
            + `NIP: ${nip}\n`
            + `Waktu: ${waktu} WIB\n`
            + 'Reset lewat Kelola Pengguna → Seluruh Pegawai.',
          allowed_mentions: { parse: [] }
        })
      })
      if (!discordRes.ok) {
        console.error('discord webhook failed', discordRes.status)
        return json({ error: 'Gagal mengirim permintaan. Silakan coba lagi.' }, 502)
      }
    }

    const { error: logError } = await admin
      .from('password_reset_requests')
      .insert({ nip_lama: nip, profile_found: !!profile, notified: shouldNotify })
    if (logError) console.error('failed to log request', logError)

    return json(OK_RESPONSE)
  } catch (err) {
    console.error(err)
    return json({ error: 'Terjadi kesalahan. Coba lagi nanti.' }, 500)
  }
})
