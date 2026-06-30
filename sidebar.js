document.addEventListener('DOMContentLoaded', () => {
  const overlay = document.getElementById('sidebarOverlay');
  const mobileMenuBtn = document.getElementById('mobileMenuBtn');

  function openSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.classList.add('open');
    if (overlay) overlay.classList.add('show');
  }

  function closeSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('show');
  }

  function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const isOpen = sidebar.classList.contains('open');
    if (isOpen) {
      closeSidebar();
    } else {
      openSidebar();
    }
  }
  if (mobileMenuBtn) mobileMenuBtn.addEventListener('click', toggleSidebar);
  if (overlay) overlay.addEventListener('click', closeSidebar);

  function setActiveNav() {
    const path = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
    document.querySelectorAll('.sidebar-nav .nav-item').forEach(a => {
      a.classList.remove('active');
      const href = (a.getAttribute('href') || '').toLowerCase();
      if ((path === '' || path === 'index.html') && href === 'index.html') {
        a.classList.add('active');
      } else if (path === href) {
        a.classList.add('active');
      }
    });
  }

  const container = document.getElementById('sidebar-container');
  if (!container) return;

  fetch('./sidebar.html')
    .then(res => res.text())
    .then(html => {
      container.innerHTML = html;

      const closeSidebarBtn = document.getElementById('closeSidebarBtn');
      if (closeSidebarBtn) closeSidebarBtn.addEventListener('click', closeSidebar);

      const navPlaceholder = document.getElementById('nav-placeholder');
      if (navPlaceholder) {
        fetch('./nav.html')
          .then(res => res.text())
          .then(navHtml => {
            navPlaceholder.innerHTML = navHtml;
            setActiveNav();
            if (typeof window.db !== 'undefined') {
              window.db.auth.getSession().then(({ data: { session } }) => {
                const widget = document.getElementById('header-user-widget');
                if (!widget) return;
                if (!session) {
                  widget.innerHTML = '<a href="login.html" class="header-login-btn">Masuk</a>';
                  document.querySelectorAll('.sidebar-nav .nav-item').forEach(el => {
                    if ((el.getAttribute('href') || '') !== 'index.html') el.style.display = 'none';
                  });
                  return;
                }
                document.querySelectorAll('.sidebar-nav .nav-item').forEach(el => {
                  el.style.display = '';
                });
                const profilePromise = typeof getCurrentProfile === 'function'
                  ? getCurrentProfile()
                  : Promise.resolve(null);
                profilePromise.then(profile => {
                  const displayName = profile?.nama || 'Pengguna';
                  widget.innerHTML = `
                    <div class="user-dropdown-wrapper">
                      <button class="user-dropdown-btn" id="userDropdownBtn">${displayName} <span class="dropdown-arrow">▾</span></button>
                      <div class="user-dropdown" id="userDropdown">
                        <a href="change-password.html" class="user-dropdown-item">🔑 Ubah Kata Sandi</a>
                        <button class="user-dropdown-item user-dropdown-danger" onclick="signOut()">🚪 Keluar</button>
                      </div>
                    </div>
                  `;
                  document.getElementById('userDropdownBtn').addEventListener('click', e => {
                    e.stopPropagation();
                    document.getElementById('userDropdown').classList.toggle('open');
                  });
                  document.addEventListener('click', () => {
                    const dd = document.getElementById('userDropdown');
                    if (dd) dd.classList.remove('open');
                  });
                });
              });
            }
          })
          .catch(err => console.error('Failed to load nav.html:', err));
      }
    })
    .catch(err => console.error('Failed to load sidebar.html:', err));
});
