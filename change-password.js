(async () => {
  const { data: { session } } = await window.db.auth.getSession();
  if (!session) {
    window.location.replace('login.html');
  }
})();

async function handleChangePassword() {
  const newPass = document.getElementById('new-password').value;
  const confirm = document.getElementById('confirm-password').value;
  const btn = document.getElementById('changeBtn');

  document.getElementById('change-error').style.display = 'none';

  if (newPass.length < 8) {
    showChangeError('Kata sandi minimal 8 karakter.');
    return;
  }
  if (newPass !== confirm) {
    showChangeError('Konfirmasi kata sandi tidak cocok.');
    return;
  }
  if (newPass === 'babelens123') {
    showChangeError('Kata sandi baru tidak boleh sama dengan kata sandi default.');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Menyimpan...';

  const { error: authError } = await window.db.auth.updateUser({ password: newPass });
  if (authError) {
    showChangeError('Gagal mengubah kata sandi: ' + authError.message);
    btn.disabled = false;
    btn.textContent = 'Simpan Kata Sandi';
    return;
  }

  const { data: { session } } = await window.db.auth.getSession();
  await window.db
    .from('profiles')
    .update({ must_change_password: false })
    .eq('id', session.user.id);

  window.location.replace('index.html');
}

function showChangeError(msg) {
  const el = document.getElementById('change-error');
  el.textContent = msg;
  el.style.display = 'block';
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('confirm-password').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleChangePassword();
  });
});
