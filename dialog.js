// Pengganti alert()/confirm() bawaan browser. Keduanya mengembalikan Promise.
function openAppDialog({ title, message, confirmText, cancelText, danger }) {
  return new Promise(resolve => {
    const previouslyFocused = document.activeElement;

    const overlay = document.createElement('div');
    overlay.className = 'app-dialog-overlay';
    overlay.innerHTML = `
      <div class="app-dialog" role="dialog" aria-modal="true" aria-labelledby="app-dialog-title">
        <div class="app-dialog-title" id="app-dialog-title"></div>
        <div class="app-dialog-message"></div>
        <div class="app-dialog-actions"></div>
      </div>`;
    overlay.querySelector('.app-dialog-title').textContent = title;
    overlay.querySelector('.app-dialog-message').textContent = message;

    const actions = overlay.querySelector('.app-dialog-actions');
    let cancelBtn = null;
    if (cancelText) {
      cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'app-dialog-btn app-dialog-btn-cancel';
      cancelBtn.textContent = cancelText;
      actions.appendChild(cancelBtn);
    }
    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'app-dialog-btn ' + (danger ? 'app-dialog-btn-danger' : 'app-dialog-btn-primary');
    confirmBtn.textContent = confirmText;
    actions.appendChild(confirmBtn);

    function close(result) {
      document.removeEventListener('keydown', onKeydown, true);
      overlay.remove();
      if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus();
      resolve(result);
    }

    function onKeydown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        close(false);
      } else if (e.key === 'Tab') {
        const focusable = [cancelBtn, confirmBtn].filter(Boolean);
        const idx = focusable.indexOf(document.activeElement);
        e.preventDefault();
        const next = e.shiftKey ? idx - 1 : idx + 1;
        focusable[(next + focusable.length) % focusable.length].focus();
      }
    }

    confirmBtn.addEventListener('click', () => close(true));
    if (cancelBtn) cancelBtn.addEventListener('click', () => close(false));
    overlay.addEventListener('mousedown', e => { if (e.target === overlay) close(false); });
    document.addEventListener('keydown', onKeydown, true);

    document.body.appendChild(overlay);
    (danger && cancelBtn ? cancelBtn : confirmBtn).focus();
  });
}

function showAlert(message, { title = 'Pemberitahuan', okText = 'OK' } = {}) {
  return openAppDialog({ title, message, confirmText: okText });
}

function showConfirm(message, { title = 'Konfirmasi', confirmText = 'Lanjutkan', cancelText = 'Batal', danger = false } = {}) {
  return openAppDialog({ title, message, confirmText, cancelText, danger });
}
