// Shared helpers for the public pages. Everything is rendered with textContent (never innerHTML).
window.core = (() => {
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null && text !== '') n.textContent = text;
    return n;
  };

  const safeUrl = (u) => {
    if (!u) return '';
    try {
      const x = new URL(u, location.origin);
      return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : '';
    } catch { return ''; }
  };

  const track = (t, x) => {
    try {
      const body = { t, p: location.pathname === '/journey/' ? '/journey' : location.pathname, x };
      if (t === 'view') body.r = document.referrer;
      navigator.sendBeacon('/api/track', new Blob([JSON.stringify(body)], { type: 'application/json' }));
    } catch { /* analytics must never break the page */ }
  };

  // Paints instantly from the last visit's copy, then refreshes from the server.
  const loadSite = (render) => {
    let cached = '';
    try { cached = localStorage.getItem('site-cache') || ''; } catch { /* ignore */ }
    if (cached) { try { render(JSON.parse(cached)); } catch { cached = ''; } }
    fetch('/api/site').then((r) => (r.ok ? r.text() : Promise.reject(r.status))).then((text) => {
      if (text === cached) return;
      try { localStorage.setItem('site-cache', text); } catch { /* ignore */ }
      render(JSON.parse(text));
    }).catch(() => {});
  };

  const paragraphs = (text) => String(text || '').split(/\n{2,}/).map((t) => t.trim()).filter(Boolean);
  const lines = (text) => String(text || '').split('\n').map((t) => t.trim()).filter(Boolean);

  const menu = document.getElementById('menu-btn');
  const nav = document.getElementById('nav');
  if (menu && nav) {
    const close = () => { nav.classList.remove('open'); menu.setAttribute('aria-expanded', 'false'); };
    menu.addEventListener('click', () => menu.setAttribute('aria-expanded', String(nav.classList.toggle('open'))));
    nav.addEventListener('click', (e) => { if (e.target.closest('a')) close(); });
  }

  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-track]');
    if (t) track('click', t.dataset.track);
  });

  return { el, safeUrl, track, loadSite, paragraphs, lines };
})();
