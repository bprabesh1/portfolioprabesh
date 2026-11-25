// Applies the saved (or system) colour theme before first paint and handles the Light / Dark switch.
(() => {
  const root = document.documentElement;
  let theme = null;
  try { theme = localStorage.getItem('theme'); } catch { /* storage unavailable */ }
  if (theme !== 'dark' && theme !== 'light') theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  root.dataset.theme = theme;

  const sync = () => document.querySelectorAll('[data-theme-set]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.themeSet === root.dataset.theme));
  });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-theme-set]');
    if (!b) return;
    root.dataset.theme = b.dataset.themeSet;
    try { localStorage.setItem('theme', b.dataset.themeSet); } catch { /* ignore */ }
    sync();
  });
  document.addEventListener('DOMContentLoaded', sync);
})();
