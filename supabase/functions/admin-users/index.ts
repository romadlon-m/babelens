import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const DEFAULT_PASSWORD = 'babelens123'
const NIP_RE = /^\d{9}$/

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
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

    // Step 2: caller must be an admin
    const { data: callerProfile, error: callerError } = await adminClient
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .maybeSingle()

    if (callerError) {
      return json({ error: 'Failed to check caller profile: ' + callerError.message }, 500)
    }
    if (!callerProfile?.is_admin) {
      return json({ error: 'Forbidden — admin only' }, 403)
    }

    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {}
    const action = body?.action

    if (action === 'list') {
      // Auth users (paginated)
      const authUsers: Record<string, any> = {}
      let page = 1
      while (true) {
        const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage: 1000 })
        if (error) return json({ error: 'Failed to list auth users: ' + error.message }, 500)
        for (const u of data.users) authUsers[u.id] = u
        if (data.users.length < 1000) break
        page++
      }

      const { data: profiles, error: profilesError } = await adminClient
        .from('profiles')
        .select('id, nip_lama, nama, is_admin, must_change_password')

      if (profilesError) return json({ error: 'Failed to list profiles: ' + profilesError.message }, 500)

      const { data: loginEvents, error: eventsError } = await adminClient
        .from('user_events')
        .select('user_id, created_at')
        .eq('event_type', 'login')
        .order('created_at', { ascending: false })

      if (eventsError) return json({ error: 'Failed to load login history: ' + eventsError.message }, 500)

      const lastLoginByUser: Record<string, string> = {}
      for (const ev of loginEvents ?? []) {
        if (!lastLoginByUser[ev.user_id]) lastLoginByUser[ev.user_id] = ev.created_at
      }

      const users = (profiles ?? []).map(p => {
        const au = authUsers[p.id]
        const googleIdentity = au?.identities?.find((i: any) => i.provider === 'google')
        return {
          id: p.id,
          nip_lama: p.nip_lama,
          nama: p.nama,
          is_admin: p.is_admin,
          must_change_password: p.must_change_password,
          banned: !!(au?.banned_until && new Date(au.banned_until) > new Date()),
          last_login: lastLoginByUser[p.id] ?? null,
          google_email: googleIdentity?.identity_data?.email ?? null
        }
      })

      return json({ users })
    }

    if (action === 'create') {
      const nipLama = String(body?.nip_lama ?? '').trim()
      const nama = String(body?.nama ?? '').trim()
      if (!NIP_RE.test(nipLama)) return json({ error: 'NIP harus 9 digit angka' }, 400)
      if (!nama) return json({ error: 'Nama wajib diisi' }, 400)

      const email = `${nipLama}@babelens.internal`
      const { data: created, error: createError } = await adminClient.auth.admin.createUser({
        email,
        password: DEFAULT_PASSWORD,
        email_confirm: true
      })
      if (createError || !created?.user) {
        return json({ error: createError?.message || 'Gagal membuat pengguna (mungkin NIP sudah terdaftar)' }, 400)
      }

      const { error: insertError } = await adminClient.from('profiles').insert({
        id: created.user.id,
        nip_lama: nipLama,
        nama,
        must_change_password: true,
        is_admin: false
      })

      if (insertError) {
        await adminClient.auth.admin.deleteUser(created.user.id)
        return json({ error: 'Gagal menyimpan profil pengguna: ' + insertError.message }, 500)
      }

      return json({ created: true, default_password: DEFAULT_PASSWORD })
    }

    if (action === 'reset-password') {
      const userId = body?.user_id
      if (!userId) return json({ error: 'user_id wajib diisi' }, 400)

      const { error: pwError } = await adminClient.auth.admin.updateUserById(userId, {
        password: DEFAULT_PASSWORD
      })
      if (pwError) return json({ error: 'Gagal mereset password: ' + pwError.message }, 500)

      const { error: profileError } = await adminClient
        .from('profiles')
        .update({ must_change_password: true })
        .eq('id', userId)
      if (profileError) return json({ error: 'Gagal memperbarui status profil: ' + profileError.message }, 500)

      return json({ reset: true, default_password: DEFAULT_PASSWORD })
    }

    if (action === 'toggle-ban') {
      const userId = body?.user_id
      const ban = !!body?.ban
      if (!userId) return json({ error: 'user_id wajib diisi' }, 400)

      const { error: banError } = await adminClient.auth.admin.updateUserById(userId, {
        ban_duration: ban ? '876000h' : 'none'
      })
      if (banError) return json({ error: 'Gagal memperbarui status akun: ' + banError.message }, 500)

      return json({ banned: ban })
    }

    return json({ error: 'Unknown action' }, 400)

  } catch (err) {
    return json({ error: 'Internal server error: ' + (err instanceof Error ? err.message : String(err)) }, 500)
  }
})
