// Home page: builds every section from /api/site.
(() => {
  'use strict';
  const { el, safeUrl, track, loadSite, paragraphs, lines } = window.core;
  const $ = (s) => document.querySelector(s);
  const host = $('#sections');
  const nav = $('#nav');
  const files = (id) => `/api/file/${encodeURIComponent(id)}`;
  let observers = [];

  function head(s, key, fallbackTitle) {
    const h = el('div', 'sec-head');
    h.append(el('h2', '', s[`${key}_title`] || fallbackTitle));
    if (s[`${key}_tagline`]) h.append(el('p', '', s[`${key}_tagline`]));
    return h;
  }

  function section(id, children) {
    const sec = el('section', 'sec');
    sec.id = id;
    const wrap = el('div', 'wrap');
    wrap.append(...children);
    sec.append(wrap);
    return sec;
  }

  const tagList = (items) => {
    const ul = el('ul', 'tags');
    items.forEach((t) => ul.append(el('li', '', t)));
    return ul;
  };

  function about(s) {
    const text = el('div', 'text');
    paragraphs(s.about_text).forEach((p) => text.append(el('p', '', p)));
    const facts = el('div', 'facts');
    facts.append(el('h3', '', 'At a glance'));
    const ul = el('ul');
    lines(s.about_points).forEach((p) => ul.append(el('li', '', p)));
    facts.append(ul);
    if (s.about_location) facts.append(el('p', 'loc', s.about_location));
    const grid = el('div', 'about');
    grid.append(text, facts);
    return section('about', [head(s, 'about', 'About Me'), grid]);
  }

  function timeline(kind, s, items) {
    const tl = el('div', 'tl');
    tl.append(el('div', 'tl-fill'));
    items.forEach((m) => {
      const item = el('article', 'tl-item');
      item.append(el('span', 'tl-dot'));
      const card = el('div', 'card');
      if (m.date_label) card.append(el('p', 'date', m.date_label));
      card.append(el('h3', '', m.title));
      if (m.org) card.append(el('p', 'org', m.org));
      if (m.description) card.append(el('p', 'd', m.description));
      if (m.skills.length) card.append(tagList(m.skills));
      item.append(card);
      tl.append(item);
    });
    return section(kind, [head(s, kind, kind), tl]);
  }

  function certificates(s, items) {
    const grid = el('div', 'grid');
    items.forEach((c) => {
      const card = el('article', 'cert');
      const thumb = el('div', 'thumb');
      if (c.mime && c.mime.startsWith('image/')) {
        const img = el('img');
        img.src = files(c.file_id); img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
        thumb.append(img);
      } else thumb.append(el('span', '', 'CERT'));
      card.append(thumb);
      const body = el('div', 'cbody');
      body.append(el('h3', '', c.title));
      const meta = [c.issuer, c.date_label].filter(Boolean).join(' · ');
      if (meta) body.append(el('p', 'meta', meta));
      if (c.description) body.append(el('p', 'd', c.description));
      const url = c.file_id ? files(c.file_id) : safeUrl(c.link);
      if (url) {
        const links = el('p', 'links');
        const a = el('a', '', c.file_id ? 'View certificate' : 'Open link');
        a.href = url; a.target = '_blank'; a.rel = 'noopener';
        a.dataset.track = 'certificate:' + c.title.slice(0, 40).toLowerCase().replace(/[^a-z0-9 ]/g, '');
        links.append(a);
        body.append(links);
      }
      card.append(body);
      grid.append(card);
    });
    return section('certificates', [head(s, 'certificates', 'Certificates'), grid]);
  }

  function projects(s, items) {
    const grid = el('div', 'grid');
    items.forEach((p) => {
      const card = el('article', 'proj');
      const thumb = el('div', 'thumb');
      if (p.image_id) {
        const img = el('img');
        img.src = files(p.image_id); img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
        thumb.append(img);
      } else thumb.append(el('span', '', p.title.split(/\s+/).map((w) => w[0]).join('').slice(0, 3).toUpperCase()));
      card.append(thumb);
      const body = el('div', 'cbody');
      if (p.status) body.append(el('p', 'status', p.status));
      body.append(el('h3', '', p.title));
      if (p.description) body.append(el('p', 'd', p.description));
      if (p.tags.length) body.append(tagList(p.tags));
      const links = el('p', 'links');
      [['Code', p.repo_url, 'repo'], ['Live', p.live_url, 'live']].forEach(([label, u, kind]) => {
        const href = safeUrl(u);
        if (!href) return;
        const a = el('a', '', label);
        a.href = href; a.target = '_blank'; a.rel = 'noopener';
        a.dataset.track = `project:${kind}:${p.title.slice(0, 30).toLowerCase().replace(/[^a-z0-9 ]/g, '')}`;
        links.append(a);
      });
      if (links.childNodes.length) body.append(links);
      card.append(body);
      grid.append(card);
    });
    return section('projects', [head(s, 'projects', 'Projects'), grid]);
  }

  function skills(s, items) {
    const cats = [];
    const byCat = new Map();
    items.forEach((k) => {
      if (!byCat.has(k.category)) { byCat.set(k.category, []); cats.push(k.category); }
      byCat.get(k.category).push(k.name);
    });
    const tools = el('div', 'tools');
    const filters = el('div', 'filters');
    const search = el('input', 'search');
    search.type = 'search'; search.placeholder = 'Search skills'; search.setAttribute('aria-label', 'Search skills'); search.maxLength = 40;
    const groups = el('div', 'skill-groups');
    const empty = el('p', 'none', 'No skills match your search.');
    empty.hidden = true;
    let active = 'All';

    const apply = () => {
      const q = search.value.trim().toLowerCase();
      let shown = 0;
      groups.querySelectorAll('.skill-group').forEach((g) => {
        const inCat = active === 'All' || g.dataset.cat === active;
        let any = 0;
        g.querySelectorAll('li').forEach((li) => {
          const hit = inCat && (!q || li.textContent.toLowerCase().includes(q));
          li.hidden = !hit;
          if (hit) any++;
        });
        g.hidden = !any;
        shown += any;
      });
      empty.hidden = shown > 0;
    };

    ['All', ...cats].forEach((c) => {
      const b = el('button', '', c);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(c === active));
      b.addEventListener('click', () => {
        active = c;
        filters.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        apply();
      });
      filters.append(b);
    });
    cats.forEach((c) => {
      const g = el('div', 'skill-group');
      g.dataset.cat = c;
      g.append(el('h3', '', c), tagList(byCat.get(c)));
      groups.append(g);
    });
    search.addEventListener('input', apply);
    tools.append(filters, search);
    return section('skills', [head(s, 'skills', 'Technical Skills'), tools, groups, empty]);
  }

  function custom(c) {
    const body = el('div', 'body');
    paragraphs(c.body).forEach((p) => body.append(el('p', '', p)));
    const h = el('div', 'sec-head');
    h.append(el('h2', '', c.title));
    if (c.tagline) h.append(el('p', '', c.tagline));
    return section(`x${c.id}`, [h, body]);
  }

  function contact(s) {
    const info = el('div');
    const reach = el('ul', 'reach');
    const add = (label, value, href) => {
      if (!value) return;
      const li = el('li');
      li.append(el('small', '', label));
      if (href) { const a = el('a', '', value); a.href = href; a.dataset.track = `contact:${label.toLowerCase()}`; if (href.startsWith('http')) { a.target = '_blank'; a.rel = 'noopener'; } li.append(a); }
      else li.append(el('span', '', value));
      reach.append(li);
    };
    add('Email', s.contact_email, /^[^\s@<>"]+@[^\s@<>"]+$/.test(s.contact_email) ? `mailto:${s.contact_email}` : '');
    add('Phone', s.contact_phone, /^[0-9+()\-\s]{5,30}$/.test(s.contact_phone) ? `tel:${s.contact_phone.replace(/[^0-9+]/g, '')}` : '');
    add('Location', s.about_location, '');
    [['GitHub', s.contact_github], ['LinkedIn', s.contact_linkedin], ['Website', s.contact_website]].forEach(([l, u]) => {
      const href = safeUrl(u);
      if (href) add(l, href.replace(/^https?:\/\//, '').replace(/\/$/, ''), href);
    });
    info.append(reach);

    const form = el('form');
    form.noValidate = true;
    const field = (label, name, type, opts = {}) => {
      const wrap = el('label');
      const cap = el('span', '', label);
      if (opts.optional) cap.append(el('i', '', ' (optional)'));
      wrap.append(cap);
      const input = el(type === 'textarea' ? 'textarea' : 'input');
      if (type !== 'textarea') input.type = type;
      input.name = name; input.maxLength = opts.max || 120;
      if (opts.required) input.required = true;
      if (opts.auto) input.autocomplete = opts.auto;
      wrap.append(input);
      return wrap;
    };
    const row = el('div', 'row');
    row.append(field('Name', 'name', 'text', { required: 1, max: 80, auto: 'name' }), field('Email', 'email', 'email', { required: 1, auto: 'email' }));
    const row2 = el('div', 'row');
    row2.append(field('Phone', 'phone', 'tel', { optional: 1, max: 30, auto: 'tel' }), field('Title', 'subject', 'text', { max: 120 }));
    const trap = field('Website', 'website', 'text', { max: 50 });
    trap.className = 'trap'; trap.setAttribute('aria-hidden', 'true');
    trap.querySelector('input').tabIndex = -1; trap.querySelector('input').autocomplete = 'off';
    const note = el('p', 'note');
    note.setAttribute('role', 'status');
    const send = el('button', 'btn submit', 'Send message');
    send.type = 'submit';
    form.append(row, row2, field('Message', 'message', 'textarea', { required: 1, max: 3000 }), trap, send, note);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      note.className = 'note'; note.textContent = '';
      send.disabled = true;
      try {
        const r = await fetch('/api/contact', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || 'Could not send. Please try again.');
        form.reset();
        note.className = 'note ok'; note.textContent = 'Thank you. Your message has been sent.';
      } catch (err) {
        note.className = 'note err'; note.textContent = err.message;
      } finally { send.disabled = false; }
    });
    const grid = el('div', 'contact');
    grid.append(info, form);
    return section('contact', [head(s, 'contact', "Let's Connect"), grid]);
  }

  function reveal() {
    observers.forEach((o) => o.disconnect());
    observers = [];
    const io = new IntersectionObserver((entries) => entries.forEach((en) => {
      if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
    }), { rootMargin: '0px 0px -12% 0px' });
    host.querySelectorAll('.tl-item').forEach((n) => io.observe(n));
    observers.push(io);

    const spy = new IntersectionObserver((entries) => entries.forEach((en) => {
      if (!en.isIntersecting) return;
      nav.querySelectorAll('a').forEach((a) => a.classList.toggle('on', a.getAttribute('href') === `#${en.target.id}`));
    }), { rootMargin: '-45% 0px -50% 0px' });
    document.querySelectorAll('main section[id]').forEach((n) => spy.observe(n));
    observers.push(spy);
  }

  let ticking = false;
  function progress() {
    ticking = false;
    const mid = innerHeight * 0.55;
    document.querySelectorAll('.tl').forEach((tl) => {
      const r = tl.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight) return;
      const p = Math.min(1, Math.max(0, (mid - r.top) / r.height));
      tl.firstChild.style.transform = `scaleY(${p})`;
    });
  }
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(progress); } }, { passive: true });

  function render(data) {
    const s = data.settings;
    document.title = s.site_title;
    const desc = document.querySelector('meta[name=description]');
    if (desc) desc.content = s.site_description;
    $('#hero-first').textContent = s.hero_first;
    $('#hero-last').textContent = s.hero_last;
    $('#hero-role').textContent = s.hero_role;
    $('#hero-tagline').textContent = s.hero_tagline;
    $('#hero-where').textContent = s.about_location;
    $('#foot-text').textContent = s.footer_text;
    if (s.hero_image) $('#hero-photo').src = `/api/file/${encodeURIComponent(s.hero_image)}`;
    const resume = $('#hero-resume');
    resume.hidden = !s.resume_file;
    if (s.resume_file) resume.href = `/api/file/${encodeURIComponent(s.resume_file)}`;

    const of = (kind) => data.milestones.filter((m) => m.kind === kind);
    const parts = [about(s)];
    const present = { about: 1 };
    ['education', 'training'].forEach((k) => { if (of(k).length) { parts.push(timeline(k, s, of(k))); present[k] = 1; } });
    if (data.certificates.length) { parts.push(certificates(s, data.certificates)); present.certificates = 1; }
    if (of('experience').length) { parts.push(timeline('experience', s, of('experience'))); present.experience = 1; }
    if (data.projects.length) { parts.push(projects(s, data.projects)); present.projects = 1; }
    if (data.skills.length) { parts.push(skills(s, data.skills)); present.skills = 1; }
    data.sections.forEach((c) => parts.push(custom(c)));
    parts.push(contact(s));
    host.replaceChildren(...parts);

    nav.querySelectorAll('a[data-sec]').forEach((a) => { a.hidden = !present[a.dataset.sec]; });
    nav.querySelectorAll('a[data-custom]').forEach((a) => a.remove());
    const contactLink = nav.querySelector('a[href="#contact"]');
    data.sections.forEach((c) => {
      const a = el('a', '', c.title);
      a.href = `#x${c.id}`; a.dataset.custom = '1';
      nav.insertBefore(a, contactLink);
    });
    reveal();
    progress();
    if (location.hash) { const t = document.getElementById(decodeURIComponent(location.hash.slice(1))); if (t) t.scrollIntoView(); }
  }

  loadSite(render);
  track('view');
})();
