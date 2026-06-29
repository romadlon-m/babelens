(async () => {
  const { data: { session } } = await window.db.auth.getSession();
  if (session) {
    const profile = await getCurrentProfile();
    if (profile?.must_change_password) {
      window.location.replace('change-password.html');
    } else {
      window.location.replace('index.html');
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
    window.location.replace('index.html');
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
});
