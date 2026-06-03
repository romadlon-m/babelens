document.addEventListener('DOMContentLoaded', () => {
  const placeholder = document.getElementById('nav-placeholder');
  if (placeholder) {
    fetch('./nav.html')
      .then(res => res.text())
      .then(html => {
        placeholder.innerHTML = html;
        setActiveNav();
      })
      .catch(err => console.error('Failed to load nav.html:', err));
  } else {
    // In case nav is already present
    setActiveNav();
  }

  function setActiveNav() {
    const path = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
    const navItems = document.querySelectorAll('.sidebar-nav .nav-item');
    navItems.forEach(a => {
      a.classList.remove('active');
      const href = (a.getAttribute('href') || '').toLowerCase();
      if ((path === '' || path === 'index.html') && href === 'index.html') {
        a.classList.add('active');
      } else if (path === href) {
        a.classList.add('active');
      }
    });
  }

  // Sidebar open/close handlers
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  const mobileMenuBtn = document.getElementById('mobileMenuBtn');
  const closeSidebarBtn = document.getElementById('closeSidebarBtn');

  if (mobileMenuBtn) mobileMenuBtn.addEventListener('click', () => {
    if (sidebar) sidebar.classList.add('open');
    if (overlay) overlay.classList.add('show');
  });
  if (closeSidebarBtn) closeSidebarBtn.addEventListener('click', () => {
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('show');
  });
  if (overlay) overlay.addEventListener('click', () => {
    if (sidebar) sidebar.classList.remove('open');
    overlay.classList.remove('show');
  });
});
