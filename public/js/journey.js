// Journey page: an auto-playing climb along one route, one checkpoint at a time.
(() => {
  'use strict';
  const { el, loadSite, track, safeUrl } = window.core;
  const $ = (s) => document.getElementById(s);
  const NS = 'http://www.w3.org/2000/svg';
  const svg = (tag, attrs = {}, parent) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (parent) parent.append(n);
    return n;
  };

  // Route on the mountain artwork (1200 x 757 image, placed 210 units below the top of a 1200 x 967 scene).
  const SKY = 210;
  const WAYPOINTS = [[235, 640], [330, 600], [380, 555], [410, 520], [470, 500], [560, 480], [650, 468], [720, 445],
    [790, 415], [860, 375], [910, 340], [860, 310], [790, 295], [700, 300], [620, 302], [540, 298], [560, 255],
    [620, 225], [660, 205], [710, 185], [760, 150], [775, 120], [740, 90], [745, 60], [745, 25]].map(([x, y]) => [x, y + SKY]);
  const BOY_H = 84; // boy height in scene units
  const BOY_W = BOY_H * 209 / 595;
  const STEP_SECONDS = 4.2; // time to climb between checkpoints
  const REST_SECONDS = 4.5; // pause at a checkpoint before climbing on
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Catmull-Rom through the waypoints, converted to cubic Bezier segments.
  const smooth = (p) => p.reduce((d, pt, i) => {
    if (!i) return `M${pt[0]} ${pt[1]}`;
    const p0 = p[i - 2] || p[i - 1], p1 = p[i - 1], p2 = pt, p3 = p[i + 1] || pt;
    return `${d} C${p1[0] + (p2[0] - p0[0]) / 6} ${p1[1] + (p2[1] - p0[1]) / 6},${p2[0] - (p3[0] - p1[0]) / 6} ${p2[1] - (p3[1] - p1[1]) / 6},${p2[0]} ${p2[1]}`;
  }, '');

  const stage = $('stage'), world = $('world'), route = $('route'), flagsHost = $('flags'), boy = $('boy');
  const hint = $('hint'), detail = $('detail'), finale = $('finale'), bar = $('bar-fill');
  const btn = { back: $('back'), play: $('play'), next: $('next'), view: $('view'), skip: $('skip') };

  const base = svg('path', { d: smooth(WAYPOINTS), class: 'base' }, route);
  svg('path', { d: base.getAttribute('d'), class: 'dash' }, route);
  const done = svg('path', { d: base.getAttribute('d'), class: 'done' }, route);
  const LEN = base.getTotalLength();
  done.style.strokeDasharray = String(LEN);
  const summit = base.getPointAtLength(LEN);

  // Two cartoon arms that meet above the climber at the summit.
  const reach = svg('g', { class: 'reach' }, route);
  const mx = summit.x, my = summit.y;
  const handShape = (g, x, y, dir) => {
    svg('ellipse', { cx: x, cy: y, rx: 6.5, ry: 7.5, class: 'skin' }, g);
    [-4.5, -1.5, 1.5, 4.5].forEach((dx) => svg('rect', { x: x + dx - 1.3, y: dir > 0 ? y + 3 : y - 13, width: 2.6, height: 10, rx: 1.3, class: 'finger' }, g));
    svg('ellipse', { cx: x - dir * 0 - 7, cy: y + (dir > 0 ? -1 : 1), rx: 2.4, ry: 4.5, class: 'finger' }, g);
  };
  const up = svg('g', { class: 'up', 'transform-origin': `${mx + 10} ${my - 52}` }, reach);
  svg('polyline', { points: `${mx + 10},${my - 52} ${mx + 28},${my - 74} ${mx + 18},${my - 100}`, class: 'arm sleeve-a', 'stroke-width': 10 }, up);
  handShape(up, mx + 18, my - 108, -1);
  const down = svg('g', { class: 'down' }, reach);
  svg('line', { x1: mx + 34, y1: my - 240, x2: mx + 20, y2: my - 128, class: 'arm sleeve-b', 'stroke-width': 13 }, down);
  handShape(down, mx + 19, my - 120, 1);
  svg('circle', { cx: mx + 19, cy: my - 114, r: 12, class: 'spark' }, reach);

  let data = null, flags = [], stops = [], n = 0;
  const st = { dist: 0, target: 0, mode: 'climb', idx: -1, rest: 0, paused: reduced, open: false, openOnArrive: false, fin: -1 };
  let s = 1, vw = 0, vh = 0, camX = 0, camY = 0, raf = 0, last = 0, bob = 0, snap = true;

  function layout() {
    vw = stage.clientWidth; vh = stage.clientHeight;
    s = Math.max(1, vw / 1200 * 1.15);
    world.style.setProperty('--s', s.toFixed(4));
    kick();
  }

  const point = (d) => base.getPointAtLength(Math.max(0, Math.min(LEN, d)));

  function buildFlags() {
    flagsHost.replaceChildren();
    flags = data.milestones.map((m, i) => {
      const p = point(stops[i]);
      const b = el('button', 'flag');
      b.type = 'button';
      b.style.setProperty('--x', p.x.toFixed(1));
      b.style.setProperty('--y', p.y.toFixed(1));
      b.setAttribute('aria-label', `Checkpoint ${i + 1}: ${m.title}`);
      b.append(el('i'), el('b', '', String(i + 1)));
      b.addEventListener('click', () => { goTo(i); st.openOnArrive = true; });
      flagsHost.append(b);
      return b;
    });
  }

  function paintUi() {
    const m = data.milestones[st.idx];
    const climbing = st.mode === 'climb';
    flags.forEach((f, i) => {
      f.classList.toggle('reached', i <= st.idx);
      f.classList.toggle('now', i === st.idx && !climbing);
    });
    hint.replaceChildren();
    if (st.fin >= 0) hint.hidden = true;
    else {
      hint.hidden = false;
      if (climbing || !m) {
        const nextNo = Math.min(n, st.idx + 2);
        hint.append(document.createTextNode(st.paused ? 'Paused' : `Climbing to checkpoint ${nextNo} of ${n}`));
      } else {
        hint.append(el('span', 'dt', m.date_label || `Checkpoint ${st.idx + 1}`), document.createTextNode(`Checkpoint ${st.idx + 1} of ${n}: ${m.title}`));
      }
    }
    btn.view.disabled = climbing || !m || st.fin >= 0;
    btn.back.disabled = (climbing ? st.idx : st.idx - 1) < 0;
    btn.play.textContent = st.paused ? 'Play' : 'Pause';
    btn.play.setAttribute('aria-pressed', String(st.paused));
    btn.next.disabled = st.fin >= 0;
  }

  const KIND = { education: 'Education', training: 'Training', experience: 'Experience' };

  function openDetail(i) {
    const m = data.milestones[i];
    if (!m) return;
    st.open = true;
    detail.replaceChildren(el('p', 'kind', `${KIND[m.kind] || ''} · checkpoint ${i + 1} of ${n}`));
    if (m.date_label) detail.append(el('p', 'date', m.date_label));
    detail.append(el('h2', '', m.title));
    if (m.org) detail.append(el('p', 'org', m.org));
    if (m.description) detail.append(el('p', 'd', m.description));
    if (m.skills.length) {
      const ul = el('ul', 'tags');
      m.skills.forEach((k) => ul.append(el('li', '', k)));
      detail.append(ul);
    }
    const row = el('div', 'row2');
    const prev = el('button', 'btn line', 'Previous');
    prev.type = 'button';
    prev.disabled = i === 0;
    prev.addEventListener('click', () => { goTo(i - 1); st.openOnArrive = true; });
    const nextB = el('button', 'btn solid', i === n - 1 ? 'Climb to the summit' : 'Next checkpoint');
    nextB.type = 'button';
    nextB.addEventListener('click', () => { goTo(i + 1); st.openOnArrive = true; if (i === n - 1) st.openOnArrive = false; });
    const close = el('button', 'btn line', 'Close');
    close.type = 'button';
    close.addEventListener('click', closeDetail);
    row.append(prev, nextB, close);
    detail.append(row);
    detail.hidden = false;
    track('click', `checkpoint:${i + 1}`);
    kick();
  }

  function closeDetail() {
    st.open = false; st.rest = 0;
    detail.hidden = true;
    kick();
  }

  function goTo(i) {
    resetFinale();
    closeDetail();
    st.openOnArrive = false;
    st.target = i >= n ? LEN : stops[Math.max(0, i)];
    st.mode = 'climb';
    st.paused = false;
    paintUi();
    kick();
  }

  function arrive() {
    if (st.target >= LEN - 0.5) { startFinale(); return; }
    st.idx = stops.indexOf(st.target);
    st.mode = 'rest'; st.rest = 0;
    paintUi();
    if (st.openOnArrive) { st.openOnArrive = false; openDetail(st.idx); }
  }

  function startFinale() {
    st.mode = 'finale'; st.fin = 0;
    st.idx = n - 1;
    paintUi();
    track('click', 'journey:summit');
  }

  function resetFinale() {
    st.fin = -1;
    world.classList.remove('f1', 'meet');
    finale.hidden = true;
  }

  function stepFinale(dt) {
    const before = st.fin;
    st.fin += dt;
    if (before < 0.9 && st.fin >= 0.9) world.classList.add('f1');
    if (before < 3.1 && st.fin >= 3.1) world.classList.add('meet');
    if (before < 4.3 && st.fin >= 4.3) finale.hidden = false;
  }

  function frame(now) {
    raf = 0;
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now;
    let busy = false;
    const speed = LEN / (Math.max(n, 1) + 1) / STEP_SECONDS * (reduced ? 6 : 1);

    if (!st.paused) {
      if (st.mode === 'climb') {
        const diff = st.target - st.dist;
        const move = Math.min(Math.abs(diff), speed * dt * Math.min(1, 0.3 + Math.abs(diff) / 60));
        st.dist += Math.sign(diff) * move;
        if (Math.abs(st.target - st.dist) < 0.3) { st.dist = st.target; arrive(); }
        busy = true;
      } else if (st.mode === 'rest' && !st.open) {
        st.rest += dt;
        if (st.rest > REST_SECONDS) goTo(st.idx + 1);
        busy = true;
      } else if (st.mode === 'finale') {
        stepFinale(dt);
        busy = st.fin < 5;
      }
    }

    // Camera follows the climber (a plain translate, so it stays on the GPU).
    const p = point(st.dist);
    const sway = st.mode === 'climb' && !st.paused ? Math.sin(now / 90) : 0;
    bob = st.mode === 'climb' && !st.paused ? Math.abs(Math.sin(now / 130)) * 5 : 0;
    const bw = BOY_W * s, bh = BOY_H * s;
    boy.style.transform = `translate3d(${(p.x * s - bw / 2).toFixed(1)}px, ${(p.y * s - bh - bob * s).toFixed(1)}px, 0) rotate(${(sway * 2.2).toFixed(2)}deg)`;
    const worldW = 1200 * s, worldH = 967 * s;
    const tx = Math.min(0, Math.max(vw - worldW, vw * 0.5 - p.x * s));
    const ty = Math.min(0, Math.max(vh - worldH, vh * 0.62 - p.y * s));
    const k = snap ? 1 : 1 - Math.exp(-dt * 3.2);
    snap = false;
    const ox = tx - camX, oy = ty - camY;
    camX += ox * k; camY += oy * k;
    world.style.transform = `translate3d(${camX.toFixed(1)}px, ${camY.toFixed(1)}px, 0)`;
    done.style.strokeDashoffset = String(LEN - st.dist);
    bar.style.transform = `scaleX(${Math.min(1, st.dist / LEN).toFixed(3)})`;

    if (busy || Math.abs(ox) > 0.4 || Math.abs(oy) > 0.4 || sway) kick();
  }

  function kick() { if (!raf && data) { last = performance.now(); raf = requestAnimationFrame(frame); } }

  function begin(d) {
    data = d;
    const s0 = d.settings;
    n = d.milestones.length;
    $('j-title').textContent = s0.journey_title;
    $('j-tag').textContent = s0.journey_tagline;
    $('fin-title').textContent = s0.journey_end_title;
    $('fin-text').textContent = s0.journey_end_text;
    const resume = $('fin-resume');
    resume.hidden = !s0.resume_file;
    if (s0.resume_file) resume.href = safeUrl(`/api/file/${encodeURIComponent(s0.resume_file)}`);
    document.title = `${s0.journey_title} | Prabesh Bhusal`;

    if (!n) { hint.textContent = 'No checkpoints yet.'; return; }
    stops = d.milestones.map((_, i) => (n === 1 ? 0.5 : 0.1 + 0.78 * i / (n - 1)) * LEN);
    buildFlags();
    resetFinale();
    closeDetail();
    Object.assign(st, { dist: 0, target: stops[0], mode: 'climb', idx: -1, rest: 0, paused: reduced, openOnArrive: false });
    snap = true;
    paintUi();
    layout();
  }

  btn.play.addEventListener('click', () => { st.paused = !st.paused; paintUi(); kick(); });
  btn.next.addEventListener('click', () => goTo(st.mode === 'climb' ? st.idx + 2 : st.idx + 1));
  btn.back.addEventListener('click', () => goTo(st.mode === 'climb' ? st.idx : st.idx - 1));
  btn.view.addEventListener('click', () => (st.open ? closeDetail() : openDetail(st.idx)));
  btn.skip.addEventListener('click', () => { resetFinale(); closeDetail(); st.dist = st.target = LEN; st.mode = 'climb'; st.paused = false; arrive(); kick(); });
  $('replay').addEventListener('click', () => begin(data));
  addEventListener('resize', layout);
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input,textarea')) return;
    if (e.key === 'ArrowRight') btn.next.click();
    else if (e.key === 'ArrowLeft') btn.back.click();
    else if (e.key === ' ' && !e.target.closest('button,a')) { e.preventDefault(); btn.play.click(); }
  });

  let started = false;
  loadSite((d) => { if (!started || JSON.stringify(d.milestones) !== JSON.stringify(data.milestones)) { started = true; begin(d); } else data = d; });
  track('view');
})();
