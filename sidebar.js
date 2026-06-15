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

  if (mobileMenuBtn) mobileMenuBtn.addEventListener('click', openSidebar);
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
          })
          .catch(err => console.error('Failed to load nav.html:', err));
      }
    })
    .catch(err => console.error('Failed to load sidebar.html:', err));
});
