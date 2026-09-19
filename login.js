// Only ever a bare "page.html" (+ optional query) from our own origin — set by
// requireAuth() when it bounces an unauthenticated visit here, or absent
// entirely for a normal visit to login.html. Rejecting anything else (a
// protocol, "//host", a leading "/") closes the open-redirect hole a raw
// `return` param would otherwise be: login.html?return=... is reachable by
// anyone, not just requireAuth()'s own redirects.
function getSafeReturnPath() {
  const ret = new URLSearchParams(window.location.search).get('return');
  if (ret && /^[a-zA-Z0-9_-]+\.html(\?\S*)?$/.test(ret)) {
    return ret;
  }
  return 'index.html';
}

(async () => {
  const { data: { session } } = await window.db.auth.getSession();
  if (session) {
    const profile = await getCurrentProfile();
    if (profile?.must_change_password) {
      window.location.replace('change-password.html');
    } else {
      window.location.replace(getSafeReturnPath());
    }
  }
})();

async function handleLogin() {
  const nip = document.getElementById('nip').value.trim();
  const password = document.getElementById('password').value;
  const btn = document.getElementById('loginBtn');
  const errorEl = document.getElementById('login-error');

  errorEl.style.display = 'none';

  if (!/^\d{9}$/.test(nip)) {
    showLoginError('NIP Lama harus 9 digit angka.');
    return;
  }
  if (!password) {
    showLoginError('Kata sandi tidak boleh kosong.');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Memproses...';

  const { error } = await signIn(nip, password);

  if (error) {
    showLoginError('NIP Lama atau kata sandi salah. Silakan coba lagi.');
    btn.disabled = false;
    btn.textContent = 'Masuk';
    return;
  }

  const profile = await getCurrentProfile();
  if (profile?.must_change_password) {
    window.location.replace('change-password.html');
  } else {
    window.location.replace(getSafeReturnPath());
  }
}

async function handleGoogleLogin() {
  sessionStorage.setItem('oauth_intent', 'login');
  sessionStorage.setItem('oauth_return', getSafeReturnPath());
  const { error } = await window.db.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.href.split('/').slice(0, -1).join('/') + '/google-callback.html',
      flowType: 'pkce'
    }
  });

  if (error) {
    showLoginError('Gagal masuk dengan Google. Silakan coba lagi.');
  }
}

function showLoginError(msg) {
  const el = document.getElementById('login-error');
  el.textContent = msg;
  el.style.display = 'block';
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('nip').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('password').focus();
  });
  document.getElementById('password').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleLogin();
  });

  const loginError = sessionStorage.getItem('login_error');
  if (loginError === 'not_registered') {
    sessionStorage.removeItem('login_error');
    showLoginError('Akun Google Anda belum terhubung ke NIP manapun. Silakan masuk dengan NIP dan kata sandi terlebih dahulu.');
  }
});
