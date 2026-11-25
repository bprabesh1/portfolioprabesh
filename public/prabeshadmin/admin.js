// Admin panel. Everything is built with textContent / DOM nodes (never innerHTML).
(() => {
  'use strict';
  const root = document.getElementById('root');
  let csrf = '';
  let me = null;

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null && text !== '') n.textContent = text;
    return n;
  };
  const btn = (label, cls, fn) => {
    const b = el('button', `btn ${cls || 'line'}`, label);
    b.type = 'button';
    if (fn) b.addEventListener('click', fn);
    return b;
  };

  // ---------- API ----------
  class ApiError extends Error {}
  async function api(method, path, body) {
    const headers = {};
    if (csrf) headers['x-csrf'] = csrf;
    let payload;
    if (body instanceof Blob) payload = body;
    else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const r = await fetch(`/api/${path}`, { method, headers, body: payload });
    const data = await r.json().catch(() => ({}));
    if (r.status === 401 && path !== 'auth/login') { showLogin(); throw new ApiError('Please sign in'); }
    if (!r.ok) throw new ApiError(data.error || 'Request failed');
    return data;
  }
  const say = (node, text, ok) => { node.className = `note ${ok ? 'ok' : 'err'}`; node.textContent = text; };
  const guard = (note, fn) => async (...a) => {
    try { await fn(...a); } catch (e) { if (note) say(note, e.message, false); else alert(e.message); }
  };
  const when = (ms) => new Date(ms).toLocaleString('en-GB', { timeZone: 'Asia/Kathmandu', dateStyle: 'medium', timeStyle: 'short' });

  // ---------- form helpers ----------
  function makeField(def, value) {
    const wrap = el('label');
    if (def.type === 'check') {
      wrap.className = 'check';
      const c = el('input'); c.type = 'checkbox'; c.checked = value == null ? true : !!value;
      wrap.append(c, document.createTextNode(def.label));
      return { node: wrap, get: () => c.checked };
    }
    wrap.append(el('span', '', def.label + (def.hint ? ` (${def.hint})` : '')));
    if (def.type === 'select') {
      const s = el('select');
      def.options.forEach(([v, t]) => { const o = el('option', '', t); o.value = v; s.append(o); });
      s.value = value ?? def.options[0][0];
      wrap.append(s);
      return { node: wrap, get: () => s.value };
    }
    if (def.type === 'file') {
      const box = el('div', 'filebox');
      let id = value || '';
      const preview = el('span');
      const show = () => {
        preview.replaceChildren();
        if (!id) return;
        if (def.kind === 'image') { const i = el('img'); i.src = `/api/file/${id}`; i.alt = ''; preview.append(i); }
        else { const a = el('a', '', 'Current file'); a.href = `/api/file/${id}`; a.target = '_blank'; a.rel = 'noopener'; preview.append(a); }
      };
      const input = el('input'); input.type = 'file'; input.accept = def.accept;
      const note = el('span', 'note');
      input.addEventListener('change', guard(note, async () => {
        const f = input.files[0];
        if (!f) return;
        say(note, 'Uploading…', true);
        const r = await api('POST', `admin/upload?kind=${def.kind === 'image' ? 'image' : 'doc'}&name=${encodeURIComponent(f.name)}`, f);
        id = r.id; show(); say(note, 'Uploaded.', true);
      }));
      const clear = btn('Remove', 'line sm', () => { id = ''; input.value = ''; show(); });
      box.append(preview, input, clear, note);
      wrap.append(box);
      show();
      return { node: wrap, get: () => id };
    }
    const area = def.type === 'area' || def.type === 'list';
    const i = el(area ? 'textarea' : 'input');
    if (!area) i.type = def.type === 'url' ? 'url' : 'text';
    if (area) i.rows = def.rows || 4;
    if (def.max) i.maxLength = def.max;
    if (def.required) i.required = true;
    const asList = (v) => { if (Array.isArray(v)) return v; try { const x = JSON.parse(v); return Array.isArray(x) ? x : []; } catch { return []; } };
    i.value = def.type === 'list' ? asList(value).join('\n') : (value ?? '');
    wrap.append(i);
    return { node: wrap, get: () => (def.type === 'list' ? i.value.split('\n').map((x) => x.trim()).filter(Boolean) : i.value) };
  }

  function openForm(title, defs, values, onSave) {
    const dlg = el('dialog');
    const form = el('form');
    form.append(el('h2', '', title));
    const fields = defs.map((d) => { const f = makeField(d, values[d.name]); form.append(f.node); return [d.name, f]; });
    const note = el('p', 'note');
    const save = el('button', 'btn solid', 'Save'); save.type = 'submit';
    const row = el('div', 'bar-row');
    row.append(save, btn('Cancel', 'line', () => dlg.close()));
    form.append(note, row);
    form.addEventListener('submit', guard(note, async (e) => {
      e.preventDefault();
      const out = {};
      fields.forEach(([k, f]) => { out[k] = f.get(); });
      await onSave(out);
      dlg.close();
    }));
    dlg.append(form);
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
  }

  // ---------- shell ----------
  const NAV = [
    ['dashboard', 'Dashboard'], ['messages', 'Messages'], ['site', 'Site content'], ['milestones', 'Education & more'],
    ['certificates', 'Certificates'], ['projects', 'Projects'], ['skills', 'Skills'], ['sections', 'Extra sections'],
    ['admins', 'Admins'], ['account', 'My account'],
  ];

  function showLogin() {
    me = null; csrf = '';
    const wrap = el('div', 'login');
    const form = el('form');
    form.append(el('h1', '', 'Admin sign in'));
    const u = makeField({ label: 'Username', type: 'text', max: 40 }, '');
    const p = makeField({ label: 'Password', type: 'text', max: 128 }, '');
    p.node.querySelector('input').type = 'password';
    p.node.querySelector('input').autocomplete = 'current-password';
    u.node.querySelector('input').autocomplete = 'username';
    const note = el('p', 'note');
    const go = el('button', 'btn solid', 'Sign in'); go.type = 'submit';
    const forgot = btn('Forgot password?', 'line sm', showRecover);
    const bar = el('div', 'bar-row'); bar.append(go, forgot);
    form.append(u.node, p.node, note, bar);
    form.addEventListener('submit', guard(note, async (e) => {
      e.preventDefault();
      const r = await api('POST', 'auth/login', { username: u.get(), password: p.get() });
      csrf = r.csrf;
      await boot();
    }));
    wrap.append(form);
    root.replaceChildren(wrap);
  }

  function showRecover() {
    const wrap = el('div', 'login');
    const form = el('form');
    form.append(el('h1', '', 'Reset password'));
    const u = makeField({ label: 'Username', type: 'text', max: 40 }, '');
    const q = el('p', 'note');
    const a = makeField({ label: 'Answer to your security question', type: 'text', max: 100 }, '');
    const pw = makeField({ label: 'New password', type: 'text', max: 128, hint: '10+ characters, letters and numbers' }, '');
    pw.node.querySelector('input').type = 'password';
    pw.node.querySelector('input').autocomplete = 'new-password';
    const note = el('p', 'note');
    const ask = btn('Show my question', 'line', guard(note, async () => {
      const r = await api('POST', 'auth/question', { username: u.get() });
      q.className = 'note'; q.textContent = r.question;
    }));
    const go = el('button', 'btn solid', 'Reset password'); go.type = 'submit';
    const bar = el('div', 'bar-row'); bar.append(go, btn('Back to sign in', 'line', showLogin));
    form.append(u.node, ask, q, a.node, pw.node, note, bar);
    form.addEventListener('submit', guard(note, async (e) => {
      e.preventDefault();
      await api('POST', 'auth/recover', { username: u.get(), answer: a.get(), password: pw.get() });
      showLogin();
    }));
    wrap.append(form);
    root.replaceChildren(wrap);
  }

  function forcePassword() {
    const wrap = el('div', 'login');
    const form = el('form');
    form.append(el('h1', '', 'Choose a new password'), el('p', 'sub', 'You must replace the temporary password before continuing.'));
    const cur = makeField({ label: 'Current password', type: 'text', max: 128 }, '');
    const nw = makeField({ label: 'New password', type: 'text', max: 128, hint: '10+ characters, letters and numbers' }, '');
    cur.node.querySelector('input').type = 'password';
    nw.node.querySelector('input').type = 'password';
    nw.node.querySelector('input').autocomplete = 'new-password';
    const note = el('p', 'note');
    const go = el('button', 'btn solid', 'Save password'); go.type = 'submit';
    form.append(cur.node, nw.node, note, go);
    form.addEventListener('submit', guard(note, async (e) => {
      e.preventDefault();
      await api('POST', 'admin/password', { current: cur.get(), password: nw.get() });
      await boot();
    }));
    wrap.append(form);
    root.replaceChildren(wrap);
  }

  async function boot() {
    try { me = await api('GET', 'admin/me'); } catch { return showLogin(); }
    csrf = me.csrf;
    if (me.must_change) return forcePassword();
    const shell = el('div', 'shell');
    const side = el('nav', 'side');
    side.setAttribute('aria-label', 'Admin');
    const brand = el('a', 'brand', 'PB'); brand.href = '/'; brand.title = 'View site';
    side.append(brand);
    NAV.filter(([k]) => k !== 'admins' || me.role === 'super').forEach(([k, label]) => {
      const a = el('a'); a.href = `#${k}`; a.dataset.k = k;
      a.append(el('span', '', label));
      if (k === 'messages') { const b = el('span', 'badge'); b.id = 'unread'; b.hidden = true; a.append(b); }
      side.append(a);
    });
    side.append(el('div', 'sp'), el('div', 'who', `${me.name} (${me.role})`));
    const theme = el('div', 'theme');
    ['light', 'dark'].forEach((t) => { const b = el('button', '', t === 'light' ? 'Light' : 'Dark'); b.type = 'button'; b.dataset.themeSet = t; b.setAttribute('aria-pressed', String(document.documentElement.dataset.theme === t)); theme.append(b); });
    const out = el('button', 'link', 'Sign out');
    out.type = 'button';
    out.addEventListener('click', guard(null, async () => { await api('POST', 'auth/logout'); showLogin(); }));
    side.append(theme, out);
    const main = el('main', 'main'); main.id = 'view';
    shell.append(side, main);
    root.replaceChildren(shell);
    route();
  }

  const VIEWS = {};
  async function route() {
    if (!me) return;
    let key = location.hash.slice(1);
    if (!VIEWS[key] || (key === 'admins' && me.role !== 'super')) key = 'dashboard';
    document.querySelectorAll('.side a[data-k]').forEach((a) => a.classList.toggle('on', a.dataset.k === key));
    const main = document.getElementById('view');
    main.replaceChildren(el('p', 'sub', 'Loading…'));
    try { main.replaceChildren(...(await VIEWS[key]())); } catch (e) { main.replaceChildren(el('p', 'note err', e.message)); }
    refreshBadge();
  }
  addEventListener('hashchange', route);
  const rerender = () => route();

  async function refreshBadge() {
    try {
      const rows = await api('GET', 'admin/messages');
      const n = rows.filter((m) => !m.is_read).length;
      const b = document.getElementById('unread');
      if (b) { b.hidden = !n; b.textContent = String(n); }
    } catch { /* ignore */ }
  }

  // ---------- generic CRUD list ----------
  function crud(resource, cfg) {
    return async () => {
      const rows = await api('GET', `admin/${resource}`);
      const out = [el('h1', '', cfg.title), el('p', 'sub', cfg.sub)];
      let filter = cfg.tabs ? cfg.tabs[0][0] : null;
      const holder = el('div');
      const tabs = el('div', 'tabs');
      const shown = () => (cfg.tabs ? rows.filter((r) => r[cfg.tabKey] === filter) : rows);

      const draw = () => {
        const list = el('div', 'list');
        const items = shown();
        if (!items.length) list.append(el('p', 'empty', 'Nothing here yet.'));
        items.forEach((r, i) => {
          const item = el('div', `item${r.visible ? '' : ' off'}`);
          const t = el('div', 't');
          t.append(el('b', '', cfg.label(r)), el('span', '', cfg.meta(r) + (r.visible ? '' : ' · hidden')));
          const acts = el('div', 'acts');
          const up = btn('↑', 'line sm', guard(null, async () => { await api('POST', `admin/${resource}/${r.id}/move`, { dir: 'up' }); rerender(); }));
          const down = btn('↓', 'line sm', guard(null, async () => { await api('POST', `admin/${resource}/${r.id}/move`, { dir: 'down' }); rerender(); }));
          up.disabled = i === 0; down.disabled = i === items.length - 1;
          up.title = 'Move up'; down.title = 'Move down';
          acts.append(up, down,
            btn('Edit', 'line sm', () => edit(r)),
            btn(r.visible ? 'Hide' : 'Show', 'line sm', guard(null, async () => { await api('PUT', `admin/${resource}/${r.id}`, { visible: !r.visible }); rerender(); })),
            btn('Delete', 'danger line sm', guard(null, async () => { if (confirm('Delete this permanently?')) { await api('DELETE', `admin/${resource}/${r.id}`); rerender(); } })));
          item.append(t, acts);
          list.append(item);
        });
        holder.replaceChildren(list);
      };

      const edit = (r) => openForm(r ? `Edit` : `Add`, cfg.fields, r || cfg.blank(filter), async (v) => {
        await api(r ? 'PUT' : 'POST', `admin/${resource}${r ? `/${r.id}` : ''}`, v);
        rerender();
      });

      if (cfg.tabs) {
        cfg.tabs.forEach(([k, label]) => {
          const b = el('button', '', label); b.type = 'button';
          b.setAttribute('aria-pressed', String(k === filter));
          b.addEventListener('click', () => { filter = k; tabs.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); draw(); });
          tabs.append(b);
        });
        out.push(tabs);
      }
      const bar = el('div', 'bar-row');
      bar.append(btn(`Add ${cfg.noun}`, 'solid', () => edit(null)));
      (cfg.extra || []).forEach((x) => bar.append(x(rerender)));
      out.push(bar, holder);
      draw();
      return out;
    };
  }

  const listField = (name, label) => ({ name, label, type: 'list', hint: 'one per line', rows: 4 });

  VIEWS.milestones = crud('milestones', {
    title: 'Education, training & experience', noun: 'entry',
    sub: 'Entries show on the home page and on the Journey page in this order. Use the arrows to reorder.',
    tabs: [['education', 'Education'], ['training', 'Training'], ['experience', 'Experience']], tabKey: 'kind',
    label: (r) => r.title, meta: (r) => [r.date_label, r.org].filter(Boolean).join(' · '),
    blank: (kind) => ({ kind, visible: 1 }),
    fields: [
      { name: 'kind', label: 'Section', type: 'select', options: [['education', 'Education'], ['training', 'Training'], ['experience', 'Experience']] },
      { name: 'title', label: 'Title', type: 'text', max: 160, required: 1 },
      { name: 'org', label: 'Institution / organisation', type: 'text', max: 200 },
      { name: 'date_label', label: 'Date shown', type: 'text', max: 60, hint: 'e.g. 2019 – 2021' },
      { name: 'start_date', label: 'Start date', type: 'text', max: 7, hint: 'YYYY or YYYY-MM, used for sorting' },
      { name: 'description', label: 'Description', type: 'area', max: 1500, rows: 5 },
      listField('skills', 'Skills'),
      { name: 'visible', label: 'Visible on the site', type: 'check' },
    ],
    extra: [(rerender) => btn('Sort everything by start date', 'line', guard(null, async () => {
      await api('POST', 'admin/milestones/sort-by-date', {}); rerender();
    }))],
  });

  VIEWS.certificates = crud('certificates', {
    title: 'Certificates', noun: 'certificate', sub: 'Upload a PDF or image, or link to the certificate online.',
    label: (r) => r.title, meta: (r) => [r.issuer, r.date_label].filter(Boolean).join(' · '),
    blank: () => ({ visible: 1 }),
    fields: [
      { name: 'title', label: 'Title', type: 'text', max: 160, required: 1 },
      { name: 'issuer', label: 'Issued by', type: 'text', max: 160 },
      { name: 'date_label', label: 'Date', type: 'text', max: 60 },
      { name: 'description', label: 'Description', type: 'area', max: 600, rows: 3 },
      { name: 'file_id', label: 'Certificate file', type: 'file', kind: 'doc', accept: 'application/pdf,image/png,image/jpeg,image/webp,image/gif' },
      { name: 'link', label: 'Or online link', type: 'url', max: 300 },
      { name: 'visible', label: 'Visible on the site', type: 'check' },
    ],
  });

  VIEWS.projects = crud('projects', {
    title: 'Projects', noun: 'project', sub: 'Project images are shown small on the home page.',
    label: (r) => r.title, meta: (r) => [r.status, JSON.parse(r.tags).join(', ')].filter(Boolean).join(' · '),
    blank: () => ({ visible: 1 }),
    fields: [
      { name: 'title', label: 'Title', type: 'text', max: 160, required: 1 },
      { name: 'description', label: 'Description', type: 'area', max: 1200, rows: 5 },
      listField('tags', 'Technologies'),
      { name: 'status', label: 'Status', type: 'text', max: 40, hint: 'e.g. Completed' },
      { name: 'image_id', label: 'Image', type: 'file', kind: 'image', accept: 'image/png,image/jpeg,image/webp,image/gif' },
      { name: 'repo_url', label: 'Code link', type: 'url', max: 300 },
      { name: 'live_url', label: 'Live link', type: 'url', max: 300 },
      { name: 'visible', label: 'Visible on the site', type: 'check' },
    ],
  });

  VIEWS.sections = crud('sections', {
    title: 'Extra sections', noun: 'section', sub: 'Add your own sections. They appear on the home page before Contact and get their own menu link.',
    label: (r) => r.title, meta: (r) => r.tagline,
    blank: () => ({ visible: 1 }),
    fields: [
      { name: 'title', label: 'Heading (also the menu name)', type: 'text', max: 80, required: 1 },
      { name: 'tagline', label: 'Tagline', type: 'text', max: 160 },
      { name: 'body', label: 'Text (blank line = new paragraph)', type: 'area', max: 4000, rows: 8 },
      { name: 'visible', label: 'Visible on the site', type: 'check' },
    ],
  });

  // ---------- skills ----------
  VIEWS.skills = async () => {
    const rows = await api('GET', 'admin/skills');
    const cats = [...new Set(rows.map((r) => r.category))];
    let cat = cats[0] || '';
    const holder = el('div');
    const tabs = el('div', 'tabs');
    const fields = [
      { name: 'category', label: 'Category', type: 'text', max: 60, required: 1 },
      { name: 'name', label: 'Skill', type: 'text', max: 80, required: 1 },
      { name: 'visible', label: 'Visible on the site', type: 'check' },
    ];
    const draw = () => {
      const list = el('div', 'list');
      const items = rows.filter((r) => r.category === cat);
      if (!items.length) list.append(el('p', 'empty', 'No skills yet.'));
      items.forEach((r, i) => {
        const item = el('div', `item${r.visible ? '' : ' off'}`);
        const t = el('div', 't'); t.append(el('b', '', r.name));
        const acts = el('div', 'acts');
        const up = btn('↑', 'line sm', guard(null, async () => { await api('POST', `admin/skills/${r.id}/move`, { dir: 'up' }); rerender(); }));
        const down = btn('↓', 'line sm', guard(null, async () => { await api('POST', `admin/skills/${r.id}/move`, { dir: 'down' }); rerender(); }));
        up.disabled = i === 0; down.disabled = i === items.length - 1;
        acts.append(up, down,
          btn('Edit', 'line sm', () => openForm('Edit skill', fields, r, async (v) => { await api('PUT', `admin/skills/${r.id}`, v); rerender(); })),
          btn(r.visible ? 'Hide' : 'Show', 'line sm', guard(null, async () => { await api('PUT', `admin/skills/${r.id}`, { visible: !r.visible }); rerender(); })),
          btn('Delete', 'danger line sm', guard(null, async () => { if (confirm('Delete this skill?')) { await api('DELETE', `admin/skills/${r.id}`); rerender(); } })));
        item.append(t, acts);
        list.append(item);
      });
      holder.replaceChildren(list);
    };
    cats.forEach((c) => {
      const b = el('button', '', c); b.type = 'button';
      b.setAttribute('aria-pressed', String(c === cat));
      b.addEventListener('click', () => { cat = c; tabs.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); draw(); });
      tabs.append(b);
    });
    const bar = el('div', 'bar-row');
    bar.append(btn('Add skills', 'solid', () => openForm('Add skills', [
      { name: 'category', label: 'Category', type: 'text', max: 60, required: 1 },
      { name: 'names', label: 'Skills', type: 'area', hint: 'one per line or comma separated', rows: 5 },
    ], { category: cat }, async (v) => { await api('POST', 'admin/skills/bulk', v); rerender(); })));
    draw();
    return [el('h1', '', 'Skills'), el('p', 'sub', 'Skills are grouped by category on the home page.'), tabs, bar, holder];
  };

  // ---------- site content ----------
  VIEWS.site = async () => {
    const list = await api('GET', 'admin/settings');
    const groups = new Map();
    list.forEach((s) => { if (!groups.has(s.group)) groups.set(s.group, []); groups.get(s.group).push(s); });
    const form = el('form');
    const fields = [];
    groups.forEach((items, name) => {
      const fs = el('fieldset');
      fs.append(el('legend', '', name));
      items.forEach((s) => {
        const def = s.kind === 'image' ? { label: s.label, type: 'file', kind: 'image', accept: 'image/png,image/jpeg,image/webp,image/gif' }
          : s.kind === 'pdf' ? { label: s.label, type: 'file', kind: 'doc', accept: 'application/pdf' }
            : { label: s.label, type: s.kind === 'text' ? 'area' : 'text', max: s.max, rows: 6 };
        const f = makeField(def, s.value);
        fields.push([s.key, f, s.value]);
        fs.append(f.node);
      });
      form.append(fs);
    });
    const note = el('p', 'note');
    const save = el('button', 'btn solid', 'Save changes'); save.type = 'submit';
    form.append(save, note);
    form.addEventListener('submit', guard(note, async (e) => {
      e.preventDefault();
      const changed = {};
      fields.forEach(([k, f, old]) => { const v = f.get(); if (v !== old) changed[k] = v; });
      if (!Object.keys(changed).length) return say(note, 'No changes to save.', true);
      await api('PUT', 'admin/settings', changed);
      fields.forEach((x) => { x[2] = x[1].get(); });
      try { localStorage.removeItem('site-cache'); } catch { /* ignore */ }
      say(note, 'Saved. Visitors see the update within a minute.', true);
    }));
    return [el('h1', '', 'Site content'), el('p', 'sub', 'Names, taglines, headings, contact details, photo and resume.'), form];
  };

  // ---------- messages ----------
  VIEWS.messages = async () => {
    const holder = el('div');
    const search = el('input'); search.type = 'search'; search.placeholder = 'Search messages'; search.maxLength = 60;
    search.setAttribute('aria-label', 'Search messages');
    const selected = new Set();
    const bulk = async (action) => {
      if (!selected.size) return;
      if (action === 'delete' && !confirm(`Delete ${selected.size} message(s)?`)) return;
      await api('POST', 'admin/messages/bulk', { ids: [...selected], action });
      load();
    };
    const bar = el('div', 'bar-row');
    bar.append(search, btn('Mark read', 'line sm', guard(null, () => bulk('read'))), btn('Mark unread', 'line sm', guard(null, () => bulk('unread'))), btn('Delete', 'danger line sm', guard(null, () => bulk('delete'))));
    async function load() {
      selected.clear();
      const rows = await api('GET', `admin/messages?q=${encodeURIComponent(search.value.trim())}`);
      const list = el('div', 'list');
      if (!rows.length) list.append(el('p', 'empty', 'No messages.'));
      rows.forEach((m) => {
        const d = el('details', `msg${m.is_read ? '' : ' unread'}`);
        const sum = el('summary');
        const c = el('input'); c.type = 'checkbox'; c.setAttribute('aria-label', `Select message ${m.id}`);
        c.addEventListener('click', (e) => e.stopPropagation());
        c.addEventListener('change', () => (c.checked ? selected.add(m.id) : selected.delete(m.id)));
        const t = el('div', 't');
        t.append(el('b', '', `${m.name}${m.subject ? ' · ' + m.subject : ''}`), el('span', '', `${when(m.created_at)}`));
        sum.append(c, el('span', 'no', `#${m.id}`), t);
        const body = el('div', 'body');
        body.append(el('p', 'meta', [m.email, m.phone].filter(Boolean).join(' · ')), document.createTextNode(m.message));
        d.append(sum, body);
        d.addEventListener('toggle', guard(null, async () => {
          if (d.open && d.classList.contains('unread')) {
            await api('POST', 'admin/messages/bulk', { ids: [m.id], action: 'read' });
            d.classList.remove('unread'); refreshBadge();
          }
        }));
        list.append(d);
      });
      holder.replaceChildren(list);
    }
    let timer;
    search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(guard(null, load), 250); });
    await load();
    return [el('h1', '', 'Messages'), el('p', 'sub', 'Contact form messages, newest first. Opening a message marks it as read.'), bar, holder];
  };

  // ---------- dashboard ----------
  VIEWS.dashboard = async () => {
    const d = await api('GET', 'admin/dashboard');
    const out = [el('h1', '', 'Dashboard'), el('p', 'sub', 'Cookieless statistics. Bots and your own signed-in visits are not counted.')];
    const cards = el('div', 'cards');
    const stat = (n, label) => { const s = el('div', 'stat'); s.append(el('b', '', String(n)), el('span', '', label)); cards.append(s); };
    stat(d.online, 'Online now');
    [7, 30, 90].forEach((p) => stat(d.periods[p].views, `Views, ${p} days`));
    stat(d.periods[30].visitors, 'Visitors, 30 days');
    stat(d.periods[30].clicks, 'Clicks, 30 days');
    stat(d.periods[30].views ? `${Math.round(d.periods[30].clicks / d.periods[30].views * 100)}%` : '0%', 'Click rate, 30 days');
    stat(d.unread, 'Unread messages');
    out.push(cards);

    const chart = el('div', 'chart');
    chart.setAttribute('role', 'img');
    chart.setAttribute('aria-label', 'Daily views, last 30 days');
    const peak = Math.max(1, ...d.daily.map((x) => x.views));
    d.daily.forEach((x) => { const b = el('i'); b.style.height = `${Math.max(2, x.views / peak * 100)}%`; b.title = `${x.day}: ${x.views} views, ${x.visitors} visitors`; chart.append(b); });
    out.push(el('h3', '', 'Views per day'), chart);

    const panels = el('div', 'panels');
    const panel = (title, rows, fmt = (x) => x) => {
      const p = el('div', 'panel'); p.append(el('h3', '', title));
      const ul = el('ul');
      if (!rows.length) ul.append(el('li', '', 'No data yet'));
      rows.forEach((r) => { const li = el('li'); li.append(el('span', '', fmt(r.label)), el('span', '', String(r.n))); ul.append(li); });
      p.append(ul); panels.append(p);
    };
    panel('Pages', d.pages, (x) => (x === '/' ? 'Home' : 'Journey'));
    panel('Where visitors come from', d.refs);
    panel('Devices', d.devices);
    panel('Countries', d.countries);
    panel('What visitors click', d.clicks);
    out.push(panels);
    return out;
  };

  // ---------- admins ----------
  VIEWS.admins = async () => {
    const rows = await api('GET', 'admin/admins');
    const list = el('div', 'list');
    rows.forEach((a) => {
      const item = el('div', 'item');
      const t = el('div', 't');
      t.append(el('b', '', `${a.name} (${a.username})`), el('span', '', `${a.role === 'super' ? 'Super admin' : 'Editor'} · added ${when(a.created_at)}${a.must_change ? ' · must change password' : ''}`));
      const acts = el('div', 'acts');
      acts.append(
        btn('Edit', 'line sm', () => openForm('Edit admin', [
          { name: 'name', label: 'Name', type: 'text', max: 60, required: 1 },
          { name: 'role', label: 'Role', type: 'select', options: [['super', 'Super admin'], ['editor', 'Editor']] },
        ], a, async (v) => { await api('PUT', `admin/admins/${a.id}`, v); rerender(); })),
        btn('Reset password', 'line sm', () => openForm('Reset password', [
          { name: 'password', label: 'Temporary password', type: 'text', max: 128, hint: '10+ characters, letters and numbers' },
        ], {}, async (v) => { await api('POST', `admin/admins/${a.id}/password`, v); rerender(); })),
        btn('Delete', 'danger line sm', guard(null, async () => { if (confirm(`Delete ${a.username}?`)) { await api('DELETE', `admin/admins/${a.id}`); rerender(); } })));
      item.append(t, acts);
      list.append(item);
    });
    const add = btn('Add admin', 'solid', () => openForm('Add admin', [
      { name: 'username', label: 'Username', type: 'text', max: 30, required: 1 },
      { name: 'name', label: 'Name', type: 'text', max: 60, required: 1 },
      { name: 'role', label: 'Role', type: 'select', options: [['editor', 'Editor (content and messages)'], ['super', 'Super admin (everything)']] },
      { name: 'password', label: 'Temporary password', type: 'text', max: 128, hint: '10+ characters, letters and numbers' },
    ], {}, async (v) => { await api('POST', 'admin/admins', v); rerender(); }));
    const bar = el('div', 'bar-row'); bar.append(add);
    return [el('h1', '', 'Admins'), el('p', 'sub', 'New and reset passwords are temporary: the person must choose their own at first sign-in.'), bar, list];
  };

  // ---------- my account ----------
  VIEWS.account = async () => {
    const info = makeField({ label: 'Display name', type: 'text', max: 60 }, me.name);
    const q = makeField({ label: 'Security question', type: 'text', max: 120, hint: 'used if you forget your password' }, me.sec_q);
    const a = makeField({ label: 'Security answer', type: 'text', max: 100, hint: 'leave empty to keep the current answer' }, '');
    const note = el('p', 'note');
    const save = el('button', 'btn solid', 'Save details'); save.type = 'submit';
    const f1 = el('form'); f1.append(info.node, q.node, a.node, save, note);
    f1.addEventListener('submit', guard(note, async (e) => {
      e.preventDefault();
      await api('PUT', 'admin/account', { name: info.get(), sec_q: q.get(), sec_a: a.get() });
      me.name = info.get(); me.sec_q = q.get();
      say(note, 'Saved.', true);
    }));
    const cur = makeField({ label: 'Current password', type: 'text', max: 128 }, '');
    const nw = makeField({ label: 'New password', type: 'text', max: 128, hint: '10+ characters, letters and numbers' }, '');
    [cur, nw].forEach((f) => { f.node.querySelector('input').type = 'password'; });
    nw.node.querySelector('input').autocomplete = 'new-password';
    const note2 = el('p', 'note');
    const go = el('button', 'btn solid', 'Change password'); go.type = 'submit';
    const f2 = el('form'); f2.append(cur.node, nw.node, go, note2);
    f2.addEventListener('submit', guard(note2, async (e) => {
      e.preventDefault();
      await api('POST', 'admin/password', { current: cur.get(), password: nw.get() });
      f2.reset(); say(note2, 'Password changed. Other devices were signed out.', true);
    }));
    return [el('h1', '', 'My account'), el('p', 'sub', `Signed in as ${me.username}.`), f1, el('br'), f2];
  };

  boot();
})();
