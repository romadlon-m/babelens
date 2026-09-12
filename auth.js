const SUPABASE_URL = 'https://cyqqohycenkoludiefgq.supabase.co';
const SUPABASE_KEY = 'sb_publishable_cuOUAfPmSs0ooVWrvbcISQ_VF5eOStv';

window.db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

async function requireAuth() {
  const { data: { session } } = await window.db.auth.getSession();
  if (!session) {
    window.location.replace('login.html');
    return null;
  }
  const { data: profile } = await window.db
    .from('profiles')
    .select('must_change_password, nip_lama, nama, is_admin, is_labeler')
    .eq('id', session.user.id)
    .single();

  if (profile?.must_change_password) {
    window.location.replace('change-password.html');
    return null;
  }

  if (!sessionStorage.getItem('session_logged')) {
    sessionStorage.setItem('session_logged', '1');
    window.db.from('user_events').insert({
      user_id: session.user.id,
      event_type: 'session_resume',
      payload: {}
    }).then(({ error }) => { if (error) console.error(error); });
  }

  return { session, profile };
}

async function signIn(nipLama, password) {
  const email = `${nipLama}@babelens.internal`;
  const result = await window.db.auth.signInWithPassword({ email, password });
  if (!result.error && result.data.session) {
    window.db.from('user_events').insert({
      user_id: result.data.session.user.id,
      event_type: 'login',
      payload: { method: 'password' }
    }).then(({ error }) => { if (error) console.error(error); });
  }
  return result;
}

async function signOut() {
  await window.db.auth.signOut();
  window.location.replace('index.html');
}

async function getCurrentProfile() {
  const { data: { session } } = await window.db.auth.getSession();
  if (!session) return null;
  const { data, error } = await window.db
    .from('profiles')
    .select('id, nip_lama, nama, must_change_password, is_admin, is_labeler')
    .eq('id', session.user.id)
    .single();
  console.log('[getCurrentProfile]', { data, error });
  return data;
}

window.db.auth.onAuthStateChange((event, session) => {
  console.log('AUTH EVENT:', event);
});